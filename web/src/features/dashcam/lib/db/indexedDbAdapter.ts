import { defaultDashcamSettings, type ClipRecord, type DashcamSettings } from '../types';
import type { DashcamDb } from './types';

const DB_NAME = 'teslasync-dashcam';
const DB_VERSION = 1;
const CLIP_STORE = 'clips';
const SETTINGS_STORE = 'settings';
const SETTINGS_KEY = 'default';

/** True when the browser exposes a usable `indexedDB` global. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIP_STORE)) {
        db.createObjectStore(CLIP_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open dashcam IndexedDB database.'));
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
    if (!dbPromise) dbPromise = openDatabase();
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
      const tx = db.transaction(CLIP_STORE, 'readwrite');
      await runRequest(tx.objectStore(CLIP_STORE).delete(id));
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
  };
}
