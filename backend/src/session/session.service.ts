import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface SessionRecord {
  id: string;
  createdAt: number;
  lastActivity: number;
  label: string;
}

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  private static readonly UUID_V4_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor() {
    const ttlHours = parseInt(process.env.SESSION_TTL_HOURS || '72', 10);
    this.ttlMs = ttlHours * 60 * 60 * 1000;

    // Cleanup every hour
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  createSession(label?: string): SessionRecord {
    const id = uuidv4();
    const now = Date.now();
    const session: SessionRecord = {
      id,
      createdAt: now,
      lastActivity: now,
      label: label || `Session ${new Date(now).toLocaleString()}`,
    };
    this.sessions.set(id, session);
    this.logger.log(`Session created: ${id} (${session.label})`);
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

    if (Date.now() - session.lastActivity > this.ttlMs) {
      this.sessions.delete(sessionId);
      this.logger.log(`Session expired and removed: ${sessionId}`);
      return false;
    }

    return true;
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.logger.log(`Session deleted: ${sessionId}`);
    }
    return deleted;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.ttlMs) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.log(`Cleaned up ${removed} expired session(s)`);
    }
  }
}
