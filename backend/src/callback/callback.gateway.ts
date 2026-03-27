import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import type { CallbackEntry } from './callback.service';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  // Use default namespace — path is what matters for nginx proxy
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class CallbackGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallbackGateway.name);
  private readonly clientSessions = new Map<string, string>();

  constructor(private readonly sessionService: SessionService) {}

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
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
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-session')
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): void {
    const sessionId = payload?.sessionId;

    if (!sessionId || typeof sessionId !== 'string') {
      client.emit('error', { message: 'sessionId is required' });
      return;
    }

    if (!this.sessionService.validateSession(sessionId)) {
      client.emit('error', { message: 'Invalid or expired session' });
      return;
    }

    // Leave previous session if any
    const previousSession = this.clientSessions.get(client.id);
    if (previousSession && previousSession !== sessionId) {
      client.leave(`session:${previousSession}`);
    }

    // Join new session room
    client.join(`session:${sessionId}`);
    this.clientSessions.set(client.id, sessionId);
    this.sessionService.touchSession(sessionId);

    client.emit('joined-session', {
      sessionId,
      message: 'Successfully joined session',
    });

    this.logger.log(`Client ${client.id} joined session ${sessionId}`);
  }

  @SubscribeMessage('leave-session')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId?: string },
  ): void {
    const sessionId = payload?.sessionId;
    if (sessionId) {
      client.leave(`session:${sessionId}`);
    }
    this.clientSessions.delete(client.id);
    this.logger.log(`Client ${client.id} left session ${sessionId || 'unknown'}`);
  }

  emitToSession(sessionId: string, entry: CallbackEntry): void {
    this.server.to(`session:${sessionId}`).emit('callback-received', entry);
    this.logger.log(`Emitted callback ${entry.id} to session room ${sessionId}`);
  }
}
