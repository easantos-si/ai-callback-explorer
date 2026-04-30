/**
 * Webhook binds — local "proxy" rules: when a callback arrives for a
 * bound session, the SPA also POSTs the same payload to a target URL.
 *
 * Design constraints:
 *   - State lives entirely in IndexedDB ('settings' store, key
 *     `binds.list`). Persists across reloads, scoped to the browser.
 *   - Forwarding runs from this tab only. If the user closes the app,
 *     no forwarding happens — that's the trade-off for keeping the
 *     proxy logic out of the backend.
 *   - The whole feature is gated by WEBHOOK_BINDS_ENABLED on the
 *     server (mirrored as `auth.webhookBindsEnabled`). When the flag
 *     is off we don't even *load* binds — old IDB rows are ignored.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useIndexedDB } from '@/composables/useIndexedDB';
import { useAuthStore } from '@/stores/auth';
import type { CallbackEntry } from '@/types';

const KEY_BINDS = 'binds.list';

export interface Bind {
  id: string;          // 8-char random — what the user types to remove
  sessionId: string;   // exact match against CallbackEntry.sessionId
  targetUrl: string;
  createdAt: string;
}

export interface ForwardResult {
  bindId: string;
  targetUrl: string;
  status: number | null;
  ok: boolean;
  error?: string;
  durationMs: number;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useBindsStore = defineStore('binds', () => {
  const db = useIndexedDB();
  const auth = useAuthStore();

  const binds = ref<Bind[]>([]);
  const hydrated = ref(false);

  async function hydrate(): Promise<void> {
    if (!auth.webhookBindsEnabled) {
      binds.value = [];
      hydrated.value = true;
      return;
    }
    try {
      const raw = await db.getSetting<Bind[]>(KEY_BINDS);
      binds.value = Array.isArray(raw) ? raw : [];
    } catch (e) {
      console.warn('Failed to hydrate binds:', e);
      binds.value = [];
    } finally {
      hydrated.value = true;
    }
  }

  async function persist(): Promise<void> {
    await db.setSetting(KEY_BINDS, binds.value).catch((e) => {
      console.warn('Failed to persist binds:', e);
    });
  }

  function listForSession(sessionId: string): Bind[] {
    return binds.value.filter((b) => b.sessionId === sessionId);
  }

  async function add(sessionId: string, targetUrl: string): Promise<Bind> {
    const bind: Bind = {
      id: newId(),
      sessionId,
      targetUrl,
      createdAt: new Date().toISOString(),
    };
    binds.value = [...binds.value, bind];
    await persist();
    return bind;
  }

  async function remove(id: string): Promise<boolean> {
    const before = binds.value.length;
    binds.value = binds.value.filter((b) => b.id !== id);
    if (binds.value.length === before) return false;
    await persist();
    return true;
  }

  /**
   * Forwards an incoming callback to every bind that matches its
   * sessionId. Returns one ForwardResult per attempt — the caller can
   * surface them however it likes (e.g. as terminal lines).
   *
   * Headers we don't forward:
   *   - Hop-by-hop / connection metadata (host, content-length).
   *   - Backend-injected request id, if any.
   * The body is re-stringified when it's a JSON object so the target
   * receives a JSON request — same shape the GUI shows.
   */
  async function forward(entry: CallbackEntry): Promise<ForwardResult[]> {
    if (!auth.webhookBindsEnabled) return [];
    const matching = listForSession(entry.sessionId);
    if (matching.length === 0) return [];

    const headers = new Headers();
    const ct = entry.contentType || 'application/json';
    headers.set('Content-Type', ct);
    headers.set('X-Forwarded-By', 'callback-explorer');
    headers.set('X-Forwarded-Method', entry.method);
    headers.set('X-Forwarded-Path', entry.path);

    let body: BodyInit | null = null;
    if (entry.body !== null && entry.body !== undefined) {
      body = typeof entry.body === 'string'
        ? entry.body
        : JSON.stringify(entry.body);
    }

    return Promise.all(matching.map(async (bind) => {
      const started = performance.now();
      try {
        const res = await fetch(bind.targetUrl, {
          method: entry.method,
          headers,
          body: ['GET', 'HEAD'].includes(entry.method) ? null : body,
        });
        return {
          bindId: bind.id,
          targetUrl: bind.targetUrl,
          status: res.status,
          ok: res.ok,
          durationMs: Math.round(performance.now() - started),
        };
      } catch (e) {
        return {
          bindId: bind.id,
          targetUrl: bind.targetUrl,
          status: null,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          durationMs: Math.round(performance.now() - started),
        };
      }
    }));
  }

  function reset(): void {
    binds.value = [];
    hydrated.value = false;
  }

  return {
    binds,
    hydrated,
    hydrate,
    listForSession,
    add,
    remove,
    forward,
    reset,
  };
});
