import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useIndexedDB } from '@/composables/useIndexedDB';
import { useAuthStore } from '@/stores/auth';
import type { Session, CallbackEntry } from '@/types';

/**
 * Per-session liveness, learned from `GET /api/sessions/:id/validate`.
 *
 *  - 'unknown'  : not yet checked (initial state, or check failed for
 *                 transient reasons like network).
 *  - 'live'     : backend recognises it; callbacks will land.
 *  - 'expired'  : backend says 404 AND the local TTL window has passed.
 *                 Treated as a normal end-of-life — the server cleaned
 *                 up because the session aged out.
 *  - 'orphaned' : backend says 404 BUT the local TTL window hasn't
 *                 passed. The server lost its in-memory map (rebuild,
 *                 restart, OOM kill). Semantically distinct: the
 *                 session didn't expire, the server forgot it.
 */
export type ServerStatus = 'unknown' | 'live' | 'expired' | 'orphaned';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const auth = useAuthStore();
  const url = `${API_BASE}/api${path}`;
  const headers = new Headers(auth.authHeaders());
  headers.set('Content-Type', 'application/json');
  if (options?.headers) {
    new Headers(options.headers).forEach((v, k) => headers.set(k, v));
  }
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    auth.logout();
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API error ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

const KEY_ACTIVE_SESSION = 'activeSessionId';

export const useSessionStore = defineStore('sessions', () => {
  const db = useIndexedDB();

  const sessions = ref<Session[]>([]);
  const activeSessionId = ref<string | null>(null);
  const entries = ref<CallbackEntry[]>([]);
  const selectedEntryId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Map<sessionId, ServerStatus>. Mutated by validateAgainstServer().
  // `getServerStatus()` consults this; `getSessionStatus()` blends it
  // with the local TTL check to produce the user-facing label.
  const serverStatus = ref<Record<string, ServerStatus>>({});

  // Keyboard-navigation focus. Distinct from `activeSessionId` /
  // `selectedEntryId`: focus is the cursor position the operator has
  // arrowed onto but not yet activated with Enter.
  const focusedSessionId = ref<string | null>(null);
  const focusedEntryId = ref<string | null>(null);

  const activeSession = computed(
    () =>
      sessions.value.find((s) => s.id === activeSessionId.value) || null,
  );

  const selectedEntry = computed(
    () =>
      entries.value.find((e) => e.id === selectedEntryId.value) || null,
  );

  async function initialize(): Promise<void> {
    try {
      await db.init();
      await loadSessions();
      await restoreActiveSession();
    } catch (e) {
      console.error('Failed to initialize store:', e);
      error.value = 'Failed to initialize local storage';
    }
    // Fire-and-forget remote check. `validateAgainstServer` blocks
    // internally until the auth phase settles, so it's safe to call
    // even before the operator finishes a login flow. Errors are
    // contained — they only flip rows into `unknown`.
    validateAgainstServer().catch((err) => {
      console.warn('[sessions] background validation failed:', err);
    });
  }

  /**
   * On boot, re-select the session that was active before the page
   * reload — if it still exists in the local list. A session that was
   * deleted/expired/wiped server-side just falls through and the user
   * lands on the empty home view as usual.
   */
  async function restoreActiveSession(): Promise<void> {
    try {
      const persisted = await db.getSetting<string>(KEY_ACTIVE_SESSION);
      if (!persisted) return;
      const stillExists = sessions.value.some((s) => s.id === persisted);
      if (!stillExists) {
        await db.deleteSetting(KEY_ACTIVE_SESSION).catch(() => {});
        return;
      }
      await selectSession(persisted);
    } catch (e) {
      console.warn('Failed to restore active session:', e);
    }
  }

  async function loadSessions(): Promise<void> {
    const rows = await db.getAllSessions();
    // Strip any legacy `callbackUrl` field stored before we moved URL
    // derivation server-side. Returning the field would type-cheat past
    // our updated Session interface and shadow the buildCallbackUrl()
    // helper for old sessions.
    sessions.value = rows.map((r) => {
      const { id, label, createdAt, entryCount } = r as Session & {
        callbackUrl?: string;
      };
      return { id, label, createdAt, entryCount };
    });
  }

  /**
   * Wait until the auth phase settles ('ok' = signed in, 'disabled'
   * = auth turned off) before returning. While 'loading' / 'captcha'
   * / 'totp' the protected endpoints would 401 and our apiRequest
   * helper would log the user out — exactly what we don't want.
   */
  function awaitAuthReady(): Promise<boolean> {
    const auth = useAuthStore();
    if (auth.phase === 'ok' || auth.phase === 'disabled') {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const stop = watch(
        () => auth.phase,
        (phase) => {
          if (phase === 'ok' || phase === 'disabled') {
            stop();
            resolve(true);
          }
        },
      );
    });
  }

  /**
   * Asks the server which of our locally-known sessions still exist.
   *
   * The validate endpoint returns 404 for both "expired" and "never
   * heard of" — backend doesn't differentiate. The semantic
   * distinction matters to the operator though: "expired" is normal
   * end-of-life, "orphaned" means the server's in-memory map was wiped
   * (rebuild, restart, OOM kill). We pick between the two by checking
   * the local TTL window: a 404 inside the TTL window is orphaned, a
   * 404 outside is expired.
   *
   * Sessions in flight when the call fails for transient reasons (no
   * network, 5xx, …) stay 'unknown' so we don't false-positive grey
   * out a working session.
   */
  async function validateAgainstServer(): Promise<void> {
    await awaitAuthReady();

    const auth = useAuthStore();
    if (!auth.isAuthenticated) return;

    const ttlMs = auth.sessionTtlHours * 60 * 60 * 1000;
    const now = Date.now();

    const ids = sessions.value.map((s) => s.id);
    const next: Record<string, ServerStatus> = { ...serverStatus.value };

    await Promise.all(
      ids.map(async (id) => {
        try {
          await apiRequest(`/sessions/${id}/validate`);
          next[id] = 'live';
        } catch (e) {
          const msg = (e as Error).message || '';
          if (msg.startsWith('API error 404')) {
            const session = sessions.value.find((s) => s.id === id);
            const created = session
              ? new Date(session.createdAt).getTime()
              : 0;
            const past = ttlMs > 0 && now - created > ttlMs;
            next[id] = past ? 'expired' : 'orphaned';
          } else if (msg.startsWith('API error 401')) {
            // apiRequest already called auth.logout(); abort.
            return;
          }
          // Other errors (network, 5xx) leave the status as-is —
          // typically 'unknown', which we render as live by default.
        }
      }),
    );
    serverStatus.value = next;
  }

  function getServerStatus(id: string): ServerStatus {
    return serverStatus.value[id] ?? 'unknown';
  }

  async function createSession(label: string): Promise<Session> {
    loading.value = true;
    error.value = null;

    try {
      const data = await apiRequest<{
        success: boolean;
        session: { id: string; label: string; createdAt: number };
      }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ label }),
      });

      const serverSession = data.session;

      // No callbackUrl field — derived on demand via buildCallbackUrl()
      // so a tampered IDB row can't redirect copy/paste targets.
      const session: Session = {
        id: serverSession.id,
        label: serverSession.label,
        createdAt: new Date(serverSession.createdAt).toISOString(),
        entryCount: 0,
      };

      await db.saveSession(session);
      sessions.value = [session, ...sessions.value];
      // The server just minted this; mark it live so the sidebar
      // doesn't flash an "unknown" hint until the next validation pass.
      serverStatus.value = { ...serverStatus.value, [session.id]: 'live' };

      return session;
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Failed to create session';
      error.value = msg;
      throw new Error(msg);
    } finally {
      loading.value = false;
    }
  }

  async function selectSession(sessionId: string): Promise<void> {
    activeSessionId.value = sessionId;
    selectedEntryId.value = null;
    focusedSessionId.value = sessionId;

    try {
      entries.value = await db.getEntriesBySession(sessionId);
      // Land focus on the most recent entry so ↑↓ has somewhere to start.
      focusedEntryId.value = entries.value[0]?.id ?? null;
    } catch (e) {
      console.error('Failed to load entries:', e);
      entries.value = [];
      focusedEntryId.value = null;
    }
    db.setSetting(KEY_ACTIVE_SESSION, sessionId).catch(() => {});
  }

  function deselectSession(): void {
    const previous = activeSessionId.value;
    activeSessionId.value = null;
    selectedEntryId.value = null;
    entries.value = [];
    focusedEntryId.value = null;
    // Keep the keyboard cursor on the session that was just deselected
    // so the user can press Enter to re-open it without re-arrowing.
    if (previous) focusedSessionId.value = previous;
    db.deleteSetting(KEY_ACTIVE_SESSION).catch(() => {});
  }

  async function deleteSessionById(sessionId: string): Promise<void> {
    // Try to delete on server (might already be expired)
    try {
      await apiRequest(`/sessions/${sessionId}`, { method: 'DELETE' });
    } catch {
      // Ignore server errors — session might be expired
    }

    await db.deleteSession(sessionId);
    sessions.value = sessions.value.filter((s) => s.id !== sessionId);
    if (serverStatus.value[sessionId]) {
      const next = { ...serverStatus.value };
      delete next[sessionId];
      serverStatus.value = next;
    }

    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null;
      entries.value = [];
      selectedEntryId.value = null;
      focusedEntryId.value = null;
      db.deleteSetting(KEY_ACTIVE_SESSION).catch(() => {});
    }
    if (focusedSessionId.value === sessionId) {
      focusedSessionId.value = null;
    }
  }

  async function addEntry(entry: CallbackEntry): Promise<void> {
    // Dedup check: avoid duplicate entries from WS reconnection
    const exists = entries.value.some((e) => e.id === entry.id);
    if (exists) {
      if (import.meta.env.DEV) {
        console.log(`[Store] Duplicate entry ignored: ${entry.id}`);
      }
      return;
    }

    await db.saveEntry(entry);

    // The server just emitted for this room — proves the session is
    // live, regardless of what an earlier validate said.
    if (serverStatus.value[entry.sessionId] !== 'live') {
      serverStatus.value = {
        ...serverStatus.value,
        [entry.sessionId]: 'live',
      };
    }

    // Only add to visible list if this session is active
    if (activeSessionId.value === entry.sessionId) {
      entries.value = [entry, ...entries.value];
    }

    // Update session entry count
    const session = sessions.value.find(
      (s) => s.id === entry.sessionId,
    );
    if (session) {
      session.entryCount = (session.entryCount || 0) + 1;
    }

    await db.updateSessionEntryCount(entry.sessionId).catch((e) => {
      console.warn('Failed to update entry count:', e);
    });
  }

  function selectEntry(entryId: string | null): void {
    selectedEntryId.value = entryId;
    if (entryId) focusedEntryId.value = entryId;
  }

  async function deleteEntryById(entryId: string): Promise<void> {
    const entry = entries.value.find((e) => e.id === entryId);
    await db.deleteEntry(entryId);

    entries.value = entries.value.filter((e) => e.id !== entryId);

    if (entry) {
      const session = sessions.value.find(
        (s) => s.id === entry.sessionId,
      );
      if (session && session.entryCount > 0) {
        session.entryCount--;
      }
      await db.updateSessionEntryCount(entry.sessionId).catch(() => {});
    }

    if (selectedEntryId.value === entryId) {
      selectedEntryId.value = null;
    }
    if (focusedEntryId.value === entryId) {
      focusedEntryId.value = entries.value[0]?.id ?? null;
    }
  }

  async function clearAll(): Promise<void> {
    // Tell the backend to drop every session we know about, so the
    // SQLite rows go away in the same operation. Done in parallel and
    // with allSettled so a single 404 (already-expired session) or
    // network blip can't block the local wipe — losing IDB+server
    // state in lockstep is the goal.
    const ids = sessions.value.map((s) => s.id);
    if (ids.length > 0) {
      await Promise.allSettled(
        ids.map((id) =>
          apiRequest(`/sessions/${id}`, { method: 'DELETE' }),
        ),
      );
    }

    await db.clearAllData();
    sessions.value = [];
    entries.value = [];
    serverStatus.value = {};
    activeSessionId.value = null;
    selectedEntryId.value = null;
    focusedSessionId.value = null;
    focusedEntryId.value = null;
    error.value = null;
    db.deleteSetting(KEY_ACTIVE_SESSION).catch(() => {});
  }

  // ---- keyboard navigation -------------------------------------------

  /**
   * Wraps around the ends so ↑ at the top jumps to the last item and ↓
   * at the bottom jumps back to the first — same convention as zsh /
   * fzf / most TUIs.
   */
  function moveSessionFocus(direction: -1 | 1): void {
    const list = sessions.value;
    if (list.length === 0) {
      focusedSessionId.value = null;
      return;
    }
    const currentIdx = list.findIndex(
      (s) => s.id === focusedSessionId.value,
    );
    let next: number;
    if (currentIdx === -1) {
      next = direction === 1 ? 0 : list.length - 1;
    } else {
      next = (currentIdx + direction + list.length) % list.length;
    }
    focusedSessionId.value = list[next].id;
  }

  function moveEntryFocus(direction: -1 | 1): void {
    const list = entries.value;
    if (list.length === 0) {
      focusedEntryId.value = null;
      return;
    }
    const currentIdx = list.findIndex(
      (e) => e.id === focusedEntryId.value,
    );
    let next: number;
    if (currentIdx === -1) {
      next = direction === 1 ? 0 : list.length - 1;
    } else {
      next = (currentIdx + direction + list.length) % list.length;
    }
    focusedEntryId.value = list[next].id;
  }

  function focusSession(id: string | null): void {
    focusedSessionId.value = id;
  }

  function focusEntry(id: string | null): void {
    focusedEntryId.value = id;
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    entries,
    selectedEntryId,
    selectedEntry,
    focusedSessionId,
    focusedEntryId,
    loading,
    error,
    serverStatus,
    initialize,
    loadSessions,
    validateAgainstServer,
    getServerStatus,
    createSession,
    selectSession,
    deselectSession,
    deleteSessionById,
    addEntry,
    selectEntry,
    deleteEntryById,
    clearAll,
    moveSessionFocus,
    moveEntryFocus,
    focusSession,
    focusEntry,
  };
});
