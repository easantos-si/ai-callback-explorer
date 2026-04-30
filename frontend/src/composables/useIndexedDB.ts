import { ref } from 'vue';
import type { Session, CallbackEntry } from '@/types';

const DB_NAME = 'ai-callback-explorer';
const DB_VERSION = 2;

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
const isReady = ref(false);

function openDB(): Promise<IDBDatabase> {
  // Singleton: avoid opening multiple connections in parallel
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('entries')) {
        const entryStore = db.createObjectStore('entries', { keyPath: 'id' });
        entryStore.createIndex('sessionId', 'sessionId', { unique: false });
        entryStore.createIndex('receivedAt', 'receivedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        // Plain key/value store: out-of-line keys, value is whatever the
        // caller stores (string, boolean, object). One row per setting.
        db.createObjectStore('settings');
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle unexpected close
      dbInstance.onclose = () => {
        dbInstance = null;
        dbPromise = null;
        isReady.value = false;
      };

      isReady.value = true;
      resolve(dbInstance);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
  });

  return dbPromise;
}

function wrapTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        const request = fn(tx);

        request.onsuccess = () => resolve(request.result);
        tx.onerror = () =>
          reject(new Error(`Transaction failed: ${tx.error?.message}`));
        tx.onabort = () =>
          reject(new Error(`Transaction aborted: ${tx.error?.message}`));
      }),
  );
}

export function useIndexedDB() {
  async function init(): Promise<void> {
    await openDB();
  }

  async function getAllSessions(): Promise<Session[]> {
    const results = await wrapTransaction<Session[]>(
      'sessions',
      'readonly',
      (tx) => tx.objectStore('sessions').getAll(),
    );
    return results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async function saveSession(session: Session): Promise<void> {
    await wrapTransaction('sessions', 'readwrite', (tx) =>
      tx.objectStore('sessions').put(session),
    );
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'entries'], 'readwrite');

      // Delete the session
      tx.objectStore('sessions').delete(sessionId);

      // Delete all entries for this session
      const entryStore = tx.objectStore('entries');
      const index = entryStore.index('sessionId');
      const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error(`Delete session failed: ${tx.error?.message}`));
    });
  }

  async function updateSessionEntryCount(
    sessionId: string,
  ): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'entries'], 'readwrite');

      const countReq = tx
        .objectStore('entries')
        .index('sessionId')
        .count(IDBKeyRange.only(sessionId));

      countReq.onsuccess = () => {
        const getReq = tx.objectStore('sessions').get(sessionId);
        getReq.onsuccess = () => {
          const session = getReq.result as Session | undefined;
          if (session) {
            session.entryCount = countReq.result;
            tx.objectStore('sessions').put(session);
          }
        };
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error(`Update count failed: ${tx.error?.message}`));
    });
  }

  async function saveEntry(entry: CallbackEntry): Promise<void> {
    await wrapTransaction('entries', 'readwrite', (tx) =>
      tx.objectStore('entries').put(entry),
    );
  }

  async function getEntriesBySession(
    sessionId: string,
  ): Promise<CallbackEntry[]> {
    const results = await wrapTransaction<CallbackEntry[]>(
      'entries',
      'readonly',
      (tx) =>
        tx
          .objectStore('entries')
          .index('sessionId')
          .getAll(IDBKeyRange.only(sessionId)),
    );
    return results.sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  }

  async function getEntry(
    id: string,
  ): Promise<CallbackEntry | undefined> {
    return wrapTransaction<CallbackEntry | undefined>(
      'entries',
      'readonly',
      (tx) => tx.objectStore('entries').get(id),
    );
  }

  async function deleteEntry(id: string): Promise<void> {
    await wrapTransaction('entries', 'readwrite', (tx) =>
      tx.objectStore('entries').delete(id),
    );
  }

  async function clearAllData(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sessions', 'entries'], 'readwrite');
      tx.objectStore('sessions').clear();
      tx.objectStore('entries').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error(`Clear data failed: ${tx.error?.message}`));
    });
  }

  async function getSetting<T>(key: string): Promise<T | null> {
    const value = await wrapTransaction<unknown>(
      'settings',
      'readonly',
      (tx) => tx.objectStore('settings').get(key),
    );
    return (value as T | undefined) ?? null;
  }

  async function setSetting(key: string, value: unknown): Promise<void> {
    await wrapTransaction('settings', 'readwrite', (tx) =>
      tx.objectStore('settings').put(value, key),
    );
  }

  async function deleteSetting(key: string): Promise<void> {
    await wrapTransaction('settings', 'readwrite', (tx) =>
      tx.objectStore('settings').delete(key),
    );
  }

  return {
    isReady,
    init,
    getAllSessions,
    saveSession,
    deleteSession,
    updateSessionEntryCount,
    saveEntry,
    getEntriesBySession,
    getEntry,
    deleteEntry,
    clearAllData,
    getSetting,
    setSetting,
    deleteSetting,
  };
}
