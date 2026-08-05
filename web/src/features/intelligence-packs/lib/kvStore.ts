/**
 * Minimal async key/value storage abstraction, with three implementations:
 *
 *   - `createIndexedDbKvStore`      — real IndexedDB (browsers).
 *   - `createLocalStorageKvStore`   — `window.localStorage` fallback, used
 *      automatically when `indexedDB` is unavailable (very old browsers,
 *      some locked-down/private-mode contexts).
 *   - `createMemoryKvStore`         — in-process `Map`, the test adapter.
 *
 * IMPORTANT: this fallback is about the STORAGE MEDIUM only. It has no
 * bearing on cryptographic verification, which is unconditional and
 * enforced entirely in `verifyEnvelope.ts` / `packCrypto.ts` regardless of
 * which `KvStore` backs the repository.
 */

export interface KvStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class IndexedDbUnavailableError extends Error {
  constructor() {
    super('IndexedDB is not available in this browsing context.');
    this.name = 'IndexedDbUnavailableError';
  }
}

function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new IndexedDbUnavailableError());
      return;
    }
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
  });
}

/** Real IndexedDB-backed KV store. Rejects with `IndexedDbUnavailableError` on first use if `indexedDB` doesn't exist — never silently falls back on its own (see `createDefaultKvStore` for the explicit, documented fallback policy). */
export function createIndexedDbKvStore(dbName: string, storeName: string): KvStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  function getDb(): Promise<IDBDatabase> {
    if (!dbPromise) dbPromise = openDatabase(dbName, storeName);
    return dbPromise;
  }
  return {
    getItem(key) {
      return getDb().then(
        (db) =>
          new Promise<string | null>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(key);
            req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
            req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed.'));
          }),
      );
    },
    setItem(key, value) {
      return getDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed.'));
          }),
      );
    },
    removeItem(key) {
      return getDb().then(
        (db) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed.'));
          }),
      );
    },
  };
}

/** `localStorage`-backed fallback. Swallows quota/private-mode write failures (matches `useMileageBudget.ts` precedent) rather than crashing the app. */
export function createLocalStorageKvStore(prefix: string): KvStore {
  return {
    async getItem(key) {
      try {
        return window.localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        window.localStorage.setItem(prefix + key, value);
      } catch {
        /* quota exceeded / private mode — best effort, in-memory state for this tab still works */
      }
    },
    async removeItem(key) {
      try {
        window.localStorage.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** In-memory `Map`-backed store — the test adapter, and a safe last-resort when neither IndexedDB nor localStorage exist. */
export function createMemoryKvStore(): KvStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

export type StorageBackend = 'indexeddb' | 'localstorage' | 'memory';

export interface DefaultKvStoreResult {
  store: KvStore;
  backend: StorageBackend;
}

/**
 * Picks the best available backend: IndexedDB when the global exists,
 * otherwise localStorage when available, otherwise in-memory (data does not
 * survive a reload — the marketplace UI surfaces `backend` so this is never
 * a silent surprise).
 */
export function createDefaultKvStore(dbName: string, storeName: string): DefaultKvStoreResult {
  if (typeof indexedDB !== 'undefined') {
    return { store: createIndexedDbKvStore(dbName, storeName), backend: 'indexeddb' };
  }
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return { store: createLocalStorageKvStore(`${dbName}:${storeName}:`), backend: 'localstorage' };
  }
  return { store: createMemoryKvStore(), backend: 'memory' };
}
