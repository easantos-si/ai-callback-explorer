/**
 * The user-facing label for a session's current state. Combines two
 * independent signals:
 *
 *   - The server's answer to GET /sessions/:id/validate (cached in
 *     `sessionStore.serverStatus`).
 *   - A purely local TTL window check (createdAt + auth.sessionTtlHours).
 *
 *  - 'live'     : server answered 200 (most recent), or a callback
 *                 just arrived for it. Treat as healthy.
 *  - 'expired'  : server says it's gone AND we're past the TTL window.
 *                 Normal end-of-life.
 *  - 'orphaned' : server says it's gone but we're still inside the
 *                 TTL window. The server's in-memory map was wiped
 *                 (rebuild, restart, OOM kill). The session didn't
 *                 expire — the server forgot it.
 *  - 'unknown'  : haven't asked yet, or asked and got a transient
 *                 error. Render as live; we'll learn next pass.
 */
import type { Session } from '@/types';
import { useSessionStore } from '@/stores/sessions';
import { useAuthStore } from '@/stores/auth';

export type SessionStatus = 'live' | 'expired' | 'orphaned' | 'unknown';

export function getSessionStatus(session: Session): SessionStatus {
  const store = useSessionStore();
  const auth = useAuthStore();

  // Server answer wins when present.
  const fromServer = store.getServerStatus(session.id);
  if (fromServer === 'live' || fromServer === 'expired' || fromServer === 'orphaned') {
    return fromServer;
  }

  // No server signal yet. Fall back to a purely local TTL guess —
  // useful for the very first frames of the SPA before the
  // background validation completes.
  const ttlMs = auth.sessionTtlHours * 60 * 60 * 1000;
  if (!ttlMs) return 'unknown';
  const created = new Date(session.createdAt).getTime();
  if (!Number.isFinite(created)) return 'unknown';
  return Date.now() - created > ttlMs ? 'expired' : 'unknown';
}

/**
 * Back-compat shim used by older call sites. Treats both "expired"
 * and "orphaned" as truthy because previously they both rendered as
 * "expired"; new call sites should prefer `getSessionStatus()` and
 * branch on the specific kind.
 */
export function isSessionExpired(session: Session): boolean {
  const s = getSessionStatus(session);
  return s === 'expired' || s === 'orphaned';
}
