import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useIndexedDB } from '@/composables/useIndexedDB';
import type { Session, CallbackEntry } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}/api${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API error ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

export const useSessionStore = defineStore('sessions', () => {
  const db = useIndexedDB();

  const sessions = ref<Session[]>([]);
  const activeSessionId = ref<string | null>(null);
  const entries = ref<CallbackEntry[]>([]);
  const selectedEntryId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

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
    } catch (e) {
      console.error('Failed to initialize store:', e);
      error.value = 'Failed to initialize local storage';
    }
  }

  async function loadSessions(): Promise<void> {
    sessions.value = await db.getAllSessions();
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
      const callbackBase = window.location.origin;

      const session: Session = {
        id: serverSession.id,
        label: serverSession.label,
        createdAt: new Date(serverSession.createdAt).toISOString(),
        callbackUrl: `${callbackBase}/api/callback/${serverSession.id}`,
        entryCount: 0,
      };

      await db.saveSession(session);
      sessions.value = [session, ...sessions.value];

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

    try {
      entries.value = await db.getEntriesBySession(sessionId);
    } catch (e) {
      console.error('Failed to load entries:', e);
      entries.value = [];
    }
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

    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null;
      entries.value = [];
      selectedEntryId.value = null;
    }
  }

  async function addEntry(entry: CallbackEntry): Promise<void> {
    // Dedup check: avoid duplicate entries from WS reconnection
    const exists = entries.value.some((e) => e.id === entry.id);
    if (exists) {
      console.log(`[Store] Duplicate entry ignored: ${entry.id}`);
      return;
    }

    await db.saveEntry(entry);

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
  }

  async function clearAll(): Promise<void> {
    await db.clearAllData();
    sessions.value = [];
    entries.value = [];
    activeSessionId.value = null;
    selectedEntryId.value = null;
    error.value = null;
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    entries,
    selectedEntryId,
    selectedEntry,
    loading,
    error,
    initialize,
    loadSessions,
    createSession,
    selectSession,
    deleteSessionById,
    addEntry,
    selectEntry,
    deleteEntryById,
    clearAll,
  };
});
