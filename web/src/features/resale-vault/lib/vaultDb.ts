/**
 * Shared IndexedDB plumbing for the Warranty & Resale Vault.
 *
 * One local database holds three object stores:
 *   - `signing_keys`  — the actual CryptoKeyPair objects (non-extractable
 *     private key + extractable public key), keyed by `key_id`. Only ever
 *     read by `signingKeyRepository.ts`; never surfaced to the UI or
 *     exported.
 *   - `key_registry`  — durable JSON metadata mirroring `SigningKeyRecord`
 *     (public JWK, created/revoked timestamps, rotation lineage). Safe to
 *     read/export; contains no secret material.
 *   - `audit_log`     — append-only local audit trail entries.
 *
 * Every function here is a thin Promise wrapper over the callback-based
 * IndexedDB API. Callers are expected to check `isIndexedDbAvailable()`
 * (or catch the rejection) and fall back to an in-memory store — this
 * module does not implement that fallback itself, it only talks to IDB.
 */
import { isIndexedDbAvailable } from './cryptoAvailability';

const DB_NAME = 'teslasync-resale-vault';
const DB_VERSION = 1;

export const STORE_SIGNING_KEYS = 'signing_keys';
export const STORE_KEY_REGISTRY = 'key_registry';
export const STORE_AUDIT_LOG = 'audit_log';

export { isIndexedDbAvailable };

/** Opens (creating on first use) the vault's IndexedDB database. Rejects if indexedDB is unavailable. */
export function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('indexedDB is not available in this environment'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SIGNING_KEYS)) {
        db.createObjectStore(STORE_SIGNING_KEYS, { keyPath: 'key_id' });
      }
      if (!db.objectStoreNames.contains(STORE_KEY_REGISTRY)) {
        db.createObjectStore(STORE_KEY_REGISTRY, { keyPath: 'key_id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIT_LOG)) {
        db.createObjectStore(STORE_AUDIT_LOG, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open resale-vault IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another open connection/tab'));
  });
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbPut<T>(db: IDBDatabase, store: string, value: T): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await runRequest(tx.objectStore(store).put(value));
}

export async function idbGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.transaction(store, 'readonly');
  return runRequest<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  const tx = db.transaction(store, 'readonly');
  return runRequest<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, 'readwrite');
  await runRequest(tx.objectStore(store).delete(key));
}
