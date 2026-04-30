import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { redactSessionId } from '../common/util/redact';
import { SessionRepository } from './session.repository';

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastActivity: number;
  label: string;
  callbackCount: number;
  callbackBytes: number;
}

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);

  /**
   * In-memory write-through cache over the SQLite repository. Reads
   * stay zero-IO (hot path: every callback POST + every WS join), and
   * writes go to both the cache and disk synchronously so we never
   * surface stale data even after a crash + restart.
   */
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly firstUseGraceMs: number;
  private readonly maxSessions: number;
  private readonly maxCallbacksPerSession: number;
  private readonly maxBytesPerSession: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(private readonly repo: SessionRepository) {
    const ttlHours = parseInt(process.env.SESSION_TTL_HOURS || '24', 10);
    this.ttlMs = ttlHours * 60 * 60 * 1000;

    const graceMin = parseInt(
      process.env.SESSION_FIRST_USE_GRACE_MIN || '60',
      10,
    );
    this.firstUseGraceMs = graceMin * 60 * 1000;

    this.maxSessions = parseInt(process.env.MAX_SESSIONS || '50000', 10);
    this.maxCallbacksPerSession = parseInt(
      process.env.MAX_CALLBACKS_PER_SESSION || '10000',
      10,
    );
    this.maxBytesPerSession = parseInt(
      process.env.MAX_BYTES_PER_SESSION || `${200 * 1024 * 1024}`,
      10,
    );
  }

  onModuleInit(): void {
    // Boot-time cleanup: anything past TTL gets deleted from disk
    // BEFORE we hydrate the cache, so the in-memory Map only ever
    // contains live sessions. Counts are logged for observability.
    const now = Date.now();
    const removed = this.repo.deleteExpired(
      now,
      this.ttlMs,
      this.firstUseGraceMs,
    );
    if (removed > 0) {
      this.logger.log(
        `Boot cleanup: removed ${removed} expired session(s) from disk`,
      );
    }
    for (const row of this.repo.listAll()) {
      this.sessions.set(row.id, row);
    }
    this.logger.log(
      `Hydrated ${this.sessions.size} live session(s) from SQLite`,
    );

    // Background sweep every 10 minutes — covers sessions that aged
    // out while the process was running. Same predicate as the boot
    // cleanup; we share the SQL via SessionRepository.deleteExpired.
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  createSession(label?: string): SessionRecord {
    if (this.sessions.size >= this.maxSessions) {
      this.logger.warn(
        `Session creation rejected: capacity reached (${this.sessions.size}/${this.maxSessions})`,
      );
      throw new ServiceUnavailableException('Server at capacity');
    }

    const id = uuidv4();
    const now = Date.now();
    const session: SessionRecord = {
      id,
      createdAt: now,
      lastActivity: now,
      label: label || `Session ${new Date(now).toLocaleString()}`,
      callbackCount: 0,
      callbackBytes: 0,
    };
    this.sessions.set(id, session);
    this.repo.upsert(session);
    this.logger.log(
      `Session created: ${redactSessionId(id)} (${session.label})`,
    );
    return session;
  }

  validateSession(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false;
    }

    if (!SessionService.UUID_V4_REGEX.test(sessionId)) {
      return false;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    if (now - session.lastActivity > this.ttlMs) {
      this.sessions.delete(sessionId);
      this.repo.delete(sessionId);
      this.logger.log(
        `Session expired and removed: ${redactSessionId(sessionId)}`,
      );
      return false;
    }

    if (
      session.callbackCount === 0 &&
      now - session.createdAt > this.firstUseGraceMs
    ) {
      this.sessions.delete(sessionId);
      this.repo.delete(sessionId);
      this.logger.log(
        `Unused session expired (first-use grace): ${redactSessionId(sessionId)}`,
      );
      return false;
    }

    return true;
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const now = Date.now();
      session.lastActivity = now;
      this.repo.touch(sessionId, now);
    }
  }

  /**
   * Reserve quota for an incoming callback. Returns false if the session
   * is missing or the per-session caps are exhausted.
   */
  recordCallback(sessionId: string, byteSize: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.callbackCount >= this.maxCallbacksPerSession) {
      this.logger.warn(
        `Per-session callback cap reached for ${redactSessionId(sessionId)}`,
      );
      return false;
    }
    if (session.callbackBytes + byteSize > this.maxBytesPerSession) {
      this.logger.warn(
        `Per-session bytes cap reached for ${redactSessionId(sessionId)}`,
      );
      return false;
    }

    const now = Date.now();
    session.callbackCount++;
    session.callbackBytes += byteSize;
    session.lastActivity = now;
    this.repo.recordCallback(sessionId, byteSize, now);
    return true;
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.repo.delete(sessionId);
      this.logger.log(`Session deleted: ${redactSessionId(sessionId)}`);
    }
    return deleted;
  }

  /**
   * Periodic sweep. Single SQL DELETE handles both expiration rules
   * (inactivity TTL + first-use grace), then we drop the matching
   * cache entries. The cache iteration mirrors the SQL predicate so
   * the two paths can't drift.
   */
  private cleanup(): void {
    const now = Date.now();
    const removedFromDisk = this.repo.deleteExpired(
      now,
      this.ttlMs,
      this.firstUseGraceMs,
    );
    let removedFromCache = 0;
    for (const [id, session] of this.sessions) {
      const expiredByActivity = now - session.lastActivity > this.ttlMs;
      const expiredByGrace =
        session.callbackCount === 0 &&
        now - session.createdAt > this.firstUseGraceMs;
      if (expiredByActivity || expiredByGrace) {
        this.sessions.delete(id);
        removedFromCache++;
      }
    }
    if (removedFromDisk > 0 || removedFromCache > 0) {
      this.logger.log(
        `Cleanup: removed ${removedFromDisk} from disk, ${removedFromCache} from cache`,
      );
    }
  }
}
