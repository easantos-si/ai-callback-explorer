import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Persistent storage for session metadata. The table maps 1:1 to
 * SessionRecord (kept in sync via this thin repository so we don't
 * mix ORM concerns with the lifecycle logic in SessionService).
 *
 * Why better-sqlite3:
 *   - Synchronous API → fits NestJS module-init / module-destroy hooks
 *     without async race conditions during shutdown.
 *   - Native (~150kB binary) → orders of magnitude faster than a pure
 *     JS / WASM driver for the small, hot workload here.
 *   - Single-file DB → naturally lives on a Docker volume; no extra
 *     server to run alongside Nest.
 *
 * Schema column names use snake_case (SQL convention); the repository
 * maps to/from the camelCase SessionRecord shape so the rest of the
 * code keeps reading naturally.
 */
export interface PersistedSession {
  id: string;
  createdAt: number;
  lastActivity: number;
  label: string;
  callbackCount: number;
  callbackBytes: number;
}

interface RawRow {
  id: string;
  created_at: number;
  last_activity: number;
  label: string;
  callback_count: number;
  callback_bytes: number;
}

function toSession(row: RawRow): PersistedSession {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    label: row.label,
    callbackCount: row.callback_count,
    callbackBytes: row.callback_bytes,
  };
}

@Injectable()
export class SessionRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRepository.name);
  private db!: DatabaseType;

  // Untyped to stay compatible with the generic-shape changes in
  // better-sqlite3 typings between v9 / v10 / v11. We bind/run with
  // explicit primitives below, so the lack of compile-time argument
  // checks doesn't hurt us in practice.
  private stmtGet!: Statement;
  private stmtUpsert!: Statement;
  private stmtTouch!: Statement;
  private stmtRecordCallback!: Statement;
  private stmtDelete!: Statement;
  private stmtDeleteExpired!: Statement;
  private stmtListAll!: Statement;
  private stmtCount!: Statement;

  onModuleInit(): void {
    const path = process.env.SQLITE_PATH || '/app/data/sessions.db';

    // Best-effort directory creation. Docker mounts will own the
    // directory already; this branch is for first-boot or local-dev
    // runs where the data dir doesn't exist yet.
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (e) {
      this.logger.warn(
        `Could not ensure SQLite parent directory: ${(e as Error).message}`,
      );
    }

    this.db = new Database(path);
    // WAL gives concurrent readers + a single writer with much better
    // throughput than the default rollback journal. NORMAL durability
    // is fine for session metadata — the worst-case data loss is a
    // few seconds of activity in a power cut.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,
        created_at      INTEGER NOT NULL,
        last_activity   INTEGER NOT NULL,
        label           TEXT NOT NULL,
        callback_count  INTEGER NOT NULL DEFAULT 0,
        callback_bytes  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
        ON sessions(last_activity);
    `);

    // Prepare every statement once; better-sqlite3 caches the parsed
    // plan internally so each call is a near-zero-cost VM dispatch.
    this.stmtGet = this.db.prepare(
      'SELECT * FROM sessions WHERE id = ?',
    );
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO sessions
        (id, created_at, last_activity, label, callback_count, callback_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_activity   = excluded.last_activity,
        label           = excluded.label,
        callback_count  = excluded.callback_count,
        callback_bytes  = excluded.callback_bytes
    `);
    this.stmtTouch = this.db.prepare(
      'UPDATE sessions SET last_activity = ? WHERE id = ?',
    );
    this.stmtRecordCallback = this.db.prepare(`
      UPDATE sessions
      SET callback_count = callback_count + 1,
          callback_bytes = callback_bytes + ?,
          last_activity  = ?
      WHERE id = ?
    `);
    this.stmtDelete = this.db.prepare(
      'DELETE FROM sessions WHERE id = ?',
    );
    // Two distinct expiration rules, ORed:
    //   - inactivity TTL (lastActivity + ttlMs < now)
    //   - "first-use grace" for sessions that never got a callback
    //     (callback_count = 0 AND createdAt + graceMs < now)
    this.stmtDeleteExpired = this.db.prepare(`
      DELETE FROM sessions
      WHERE (? - last_activity) > ?
         OR (callback_count = 0 AND (? - created_at) > ?)
    `);
    this.stmtListAll = this.db.prepare(
      'SELECT * FROM sessions ORDER BY last_activity DESC',
    );
    this.stmtCount = this.db.prepare(
      'SELECT COUNT(*) AS n FROM sessions',
    );

    this.logger.log(`SQLite session store opened at ${path}`);
  }

  onModuleDestroy(): void {
    try {
      this.db?.close();
    } catch (e) {
      this.logger.warn(`SQLite close failed: ${(e as Error).message}`);
    }
  }

  // ---- queries -----------------------------------------------------

  get(id: string): PersistedSession | undefined {
    const row = this.stmtGet.get(id) as RawRow | undefined;
    return row ? toSession(row) : undefined;
  }

  listAll(): PersistedSession[] {
    return (this.stmtListAll.all() as RawRow[]).map(toSession);
  }

  count(): number {
    return (this.stmtCount.get() as { n: number }).n;
  }

  // ---- mutations ---------------------------------------------------

  upsert(s: PersistedSession): void {
    this.stmtUpsert.run(
      s.id,
      s.createdAt,
      s.lastActivity,
      s.label,
      s.callbackCount,
      s.callbackBytes,
    );
  }

  touch(id: string, lastActivity: number): void {
    this.stmtTouch.run(lastActivity, id);
  }

  recordCallback(id: string, byteSize: number, lastActivity: number): void {
    this.stmtRecordCallback.run(byteSize, lastActivity, id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  /**
   * Bulk-removes every expired row. Returns the number deleted so
   * callers can log it. Uses the same predicate the in-memory cleanup
   * uses, so the two paths can never disagree.
   */
  deleteExpired(now: number, ttlMs: number, graceMs: number): number {
    const result = this.stmtDeleteExpired.run(now, ttlMs, now, graceMs);
    return result.changes;
  }
}
