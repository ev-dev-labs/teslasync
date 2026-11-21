import { defaultDashcamSettings, type ClipRecord, type DashcamSettings } from '../types';
import { canChangeRetention, type ClipRetention } from '../clipRetention';
import type { DashcamDb } from './types';

const DB_NAME = 'teslasync-dashcam';
const DB_VERSION = 2;
const CLIP_STORE = 'clips';
const SETTINGS_STORE = 'settings';
const SETTINGS_KEY = 'default';
const RETENTION_STORE = 'retention';
const RETENTION_SCOPE = 'by-scope';
const RETENTION_CLIP = 'by-clip';

/** True when the browser exposes a usable `indexedDB` global. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE)) {
        db.createObjectStore(CLIP_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(RETENTION_STORE)) {
        const store = db.createObjectStore(RETENTION_STORE, { keyPath: ['subject', 'vehicleId', 'clipId'] });
        store.createIndex(RETENTION_SCOPE, ['subject', 'vehicleId']);
        store.createIndex(RETENTION_CLIP, 'clipId');
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close other Dashcam tabs to finish updating local storage.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open dashcam IndexedDB database.'));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Dashcam storage transaction aborted.'));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

/**
 * Real, persistent IndexedDB-backed `DashcamDb`. Throws synchronously if
 * IndexedDB is unavailable — callers should check {@link isIndexedDbAvailable}
 * (or catch this constructor error) and fall back to the memory adapter
 * with an explicit user-facing warning, rather than silently degrading.
 */
export function createIndexedDbDashcamDb(): DashcamDb {
  if (!isIndexedDbAvailable()) {
    throw new Error(
      'IndexedDB is not available in this browser context. Dashcam clip storage requires IndexedDB support.',
    );
  }

  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) dbPromise = openDatabase().then((db) => {
      db.onversionchange = () => { db.close(); dbPromise = null; };
      return db;
    }, (error: unknown) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };

  return {
    async listClips() {
      const db = await getDb();
      const tx = db.transaction(CLIP_STORE, 'readonly');
      const all = await runRequest<ClipRecord[]>(tx.objectStore(CLIP_STORE).getAll());
      return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getClip(id) {
      const db = await getDb();
      const tx = db.transaction(CLIP_STORE, 'readonly');
      const record = await runRequest<ClipRecord | undefined>(tx.objectStore(CLIP_STORE).get(id));
      return record ?? null;
    },
    async putClip(clip) {
      const db = await getDb();
      const tx = db.transaction(CLIP_STORE, 'readwrite');
      await runRequest(tx.objectStore(CLIP_STORE).put(clip));
    },
    async deleteClip(id) {
      const db = await getDb();
      const tx = db.transaction([CLIP_STORE, RETENTION_STORE], 'readwrite');
      const store = tx.objectStore(RETENTION_STORE);
      const clearRetention = runRequest(store.index(RETENTION_CLIP).getAllKeys(id)).then((keys) =>
        Promise.all(keys.map((key) => runRequest(store.delete(key)))));
      await Promise.all([committed(tx), clearRetention, runRequest(tx.objectStore(CLIP_STORE).delete(id))]);
    },
    async getSettings() {
      const db = await getDb();
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const record = await runRequest<{ key: string; value: DashcamSettings } | undefined>(
        tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY),
      );
      return record?.value ?? defaultDashcamSettings();
    },
    async putSettings(settings) {
      const db = await getDb();
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      await runRequest(tx.objectStore(SETTINGS_STORE).put({ key: SETTINGS_KEY, value: settings }));
    },
    async listRetention(subject, vehicleId) {
      const db = await getDb();
      const tx = db.transaction(RETENTION_STORE, 'readonly');
      return runRequest<ClipRetention[]>(tx.objectStore(RETENTION_STORE).index(RETENTION_SCOPE).getAll([subject, vehicleId]));
    },
    async changeRetention(change) {
      const db = await getDb();
      const tx = db.transaction([CLIP_STORE, RETENTION_STORE], 'readwrite');
      const store = tx.objectStore(RETENTION_STORE);
      const write = Promise.all([
        runRequest<ClipRetention | undefined>(store.get(change.key)),
        runRequest<ClipRecord | undefined>(tx.objectStore(CLIP_STORE).get(change.key[2])),
      ]).then(async ([current, clip]) => {
        if (!canChangeRetention(current, clip, change)) return false;
        if (change.next) await runRequest(store.put(change.next));
        else await runRequest(store.delete(change.key));
        return true;
      });
      const [, changed] = await Promise.all([committed(tx), write]);
      return changed;
    },
  };
}
