import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { AuthService } from '../auth/auth.service';
import { redactSessionId } from '../common/util/redact';
import { JoinSessionDto } from './dto/join-session.dto';
import type { CallbackEntry } from './callback.service';
import {
  isFilteringEnabled,
  isOriginAllowed,
  listOrigins,
} from '../admin/allowed-origins.state';

const wsCorsOrigin: ((
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean | string) => void,
) => void) = (origin, cb) => {
  // Filtering disabled ⇒ accept any handshake (auth still applies via the
  // JWT middleware, separately).
  if (!isFilteringEnabled()) return cb(null, true);

  // Browsers always send Origin on the WS upgrade. Fail closed if unset
  // and we have an allowlist. The origin set is mutable at runtime via
  // the admin/origins endpoint, so each upgrade re-reads the current state.
  if (!origin) {
    return cb(null, listOrigins().length === 0);
  }
  cb(null, isOriginAllowed(origin));
};

interface FloodTracker {
  windowStart: number;
  count: number;
}

const JOIN_RATE_WINDOW_MS = 1000;
const JOIN_RATE_MAX = 5;
const MAX_CONNECTIONS_PER_IP = 50;

@WebSocketGateway({
  cors: { origin: wsCorsOrigin, credentials: false },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64_000,
  connectTimeout: 10_000,
})
export class CallbackGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallbackGateway.name);
  private readonly clientSessions = new Map<string, string>();
  private readonly clientFlood = new Map<string, FloodTracker>();
  private readonly connectionsByIp = new Map<string, number>();
  private readonly clientIps = new Map<string, string>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly authService: AuthService,
  ) {}

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');

    // Per-IP connection cap at the engine.io middleware layer.
    this.server.use((socket, next) => {
      const ip = this.resolveSocketIp(socket);
      const current = this.connectionsByIp.get(ip) ?? 0;
      if (current >= MAX_CONNECTIONS_PER_IP) {
        return next(new Error('Too many connections from this address'));
      }
      this.connectionsByIp.set(ip, current + 1);
      this.clientIps.set(socket.id, ip);
      next();
    });

    // JWT check on the WS handshake. Auth-disabled deploys skip this so
    // legacy clients keep working unchanged.
    this.server.use((socket, next) => {
      if (!this.authService.enabled) return next();
      const auth = socket.handshake.auth as
        | { token?: string }
        | undefined;
      const token = auth?.token;
      if (!token) return next(new Error('Unauthorized'));
      try {
        this.authService.verifyToken(token);
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(@ConnectedSocket() client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    const sessionId = this.clientSessions.get(client.id);
    if (sessionId) {
      client.leave(`session:${sessionId}`);
      this.clientSessions.delete(client.id);
    }
    this.clientFlood.delete(client.id);

    const ip = this.clientIps.get(client.id);
    if (ip) {
      const current = this.connectionsByIp.get(ip) ?? 0;
      if (current <= 1) this.connectionsByIp.delete(ip);
      else this.connectionsByIp.set(ip, current - 1);
      this.clientIps.delete(client.id);
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-session')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new WsException(
          errors.flatMap((e) => Object.values(e.constraints ?? {})).join(', '),
        ),
    }),
  )
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionDto,
  ): void {
    if (!this.allowEvent(client.id)) {
      client.emit('error', { message: 'Rate limit exceeded' });
      return;
    }

    const sessionId = payload.sessionId;

    if (!this.sessionService.validateSession(sessionId)) {
      client.emit('error', { message: 'Invalid or expired session' });
      return;
    }

    const previousSession = this.clientSessions.get(client.id);
    if (previousSession && previousSession !== sessionId) {
      client.leave(`session:${previousSession}`);
    }

    client.join(`session:${sessionId}`);
    this.clientSessions.set(client.id, sessionId);
    this.sessionService.touchSession(sessionId);

    client.emit('joined-session', {
      sessionId,
      message: 'Successfully joined session',
    });

    this.logger.log(
      `Client ${client.id} joined ${redactSessionId(sessionId)}`,
    );
  }

  @SubscribeMessage('leave-session')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new WsException(
          errors.flatMap((e) => Object.values(e.constraints ?? {})).join(', '),
        ),
    }),
  )
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionDto,
  ): void {
    if (!this.allowEvent(client.id)) return;

    const joined = this.clientSessions.get(client.id);
    if (joined !== payload.sessionId) return; // ignore mismatched leaves

    client.leave(`session:${joined}`);
    this.clientSessions.delete(client.id);
    this.logger.log(
      `Client ${client.id} left ${redactSessionId(joined)}`,
    );
  }

  emitToSession(sessionId: string, entry: CallbackEntry): void {
    this.server.to(`session:${sessionId}`).emit('callback-received', entry);
    this.logger.log(
      `Emitted callback ${entry.id} to ${redactSessionId(sessionId)}`,
    );
  }

  private allowEvent(clientId: string): boolean {
    const now = Date.now();
    let tracker = this.clientFlood.get(clientId);
    if (!tracker || now - tracker.windowStart > JOIN_RATE_WINDOW_MS) {
      tracker = { windowStart: now, count: 0 };
      this.clientFlood.set(clientId, tracker);
    }
    tracker.count++;
    return tracker.count <= JOIN_RATE_MAX;
  }

  private resolveSocketIp(socket: Socket): string {
    const headers = socket.handshake.headers;
    const cf = headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    const xri = headers['x-real-ip'];
    if (typeof xri === 'string' && xri) return xri;
    return socket.handshake.address || 'unknown';
  }
}
