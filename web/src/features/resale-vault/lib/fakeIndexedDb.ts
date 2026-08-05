/**
 * Minimal in-memory IndexedDB fake for tests.
 *
 * jsdom (this project's Vitest `environment`) does not implement
 * IndexedDB at all, so `signingKeyRepository`/`auditTrail`'s "IndexedDB is
 * supported" code paths are otherwise untestable. This fake implements just
 * enough of the spec — `open`, `onupgradeneeded`, `createObjectStore`,
 * `transaction`, `objectStore().get/put/getAll/delete` — for our repository
 * code to exercise its persisted-path logic in tests.
 *
 * IMPORTANT caveat (documented, not hidden): a real browser's IndexedDB
 * performs a structured-clone of every stored value. Some older browsers
 * (notably Safari < 14) could not structured-clone a non-extractable
 * `CryptoKey` and threw `DataCloneError`. This fake stores object
 * references directly (no real structured-clone/serialization), so it
 * cannot reproduce that specific browser bug — it validates our
 * capability-probe *code path* (open → put → get → delete → compare),
 * not real browser structured-clone compatibility. That gap is called out
 * in the verification report; it is a test-environment limitation, not a
 * production behavior gap.
 */

interface FakeStore {
  keyPath: string;
  rows: Map<IDBValidKey, unknown>;
}

class FakeIDBRequest<T> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  resolve(value: T): void {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.());
  }

  reject(err: Error): void {
    this.error = err;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeObjectStore {
  constructor(private store: FakeStore) {}

  get(key: IDBValidKey): FakeIDBRequest<unknown> {
    const req = new FakeIDBRequest<unknown>();
    req.resolve(this.store.rows.get(key));
    return req;
  }

  getAll(): FakeIDBRequest<unknown[]> {
    const req = new FakeIDBRequest<unknown[]>();
    req.resolve(Array.from(this.store.rows.values()));
    return req;
  }

  put(value: Record<string, unknown>): FakeIDBRequest<IDBValidKey> {
    const req = new FakeIDBRequest<IDBValidKey>();
    const key = value[this.store.keyPath] as IDBValidKey;
    this.store.rows.set(key, value);
    req.resolve(key);
    return req;
  }

  delete(key: IDBValidKey): FakeIDBRequest<undefined> {
    const req = new FakeIDBRequest<undefined>();
    this.store.rows.delete(key);
    req.resolve(undefined);
    return req;
  }
}

class FakeTransaction {
  constructor(private db: FakeDatabase) {}
  objectStore(name: string): FakeObjectStore {
    const store = this.db.stores.get(name);
    if (!store) throw new Error(`FakeIndexedDb: no such object store "${name}"`);
    return new FakeObjectStore(store);
  }
}

class FakeDatabase {
  stores = new Map<string, FakeStore>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  createObjectStore(name: string, options: { keyPath: string }): void {
    this.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
  }
  transaction(_names: string | string[], _mode?: string): FakeTransaction {
    return new FakeTransaction(this);
  }
  close(): void {
    /* no-op */
  }
}

class FakeIDBOpenDBRequest extends FakeIDBRequest<FakeDatabase> {
  onupgradeneeded: (() => void) | null = null;
}

/** Shared singleton DB instance so repeated `indexedDB.open()` calls in one test see the same data. */
let sharedDb: FakeDatabase | null = null;

function fakeOpen(_name: string, _version?: number): FakeIDBOpenDBRequest {
  const req = new FakeIDBOpenDBRequest();
  const isNew = sharedDb === null;
  if (isNew) sharedDb = new FakeDatabase();
  const db = sharedDb!;
  queueMicrotask(() => {
    // Real IndexedDB already has `request.result` populated with the
    // (upgrading) database by the time `onupgradeneeded` fires — callers
    // read `request.result` from inside that handler. Set it first, then
    // fire onupgradeneeded, then resolve (which fires onsuccess).
    req.result = db;
    if (isNew) req.onupgradeneeded?.();
    req.resolve(db);
  });
  return req;
}

/** Installs the fake `indexedDB` global. Call `uninstallFakeIndexedDb()` in `afterEach`. */
export function installFakeIndexedDb(): void {
  sharedDb = null;
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = { open: fakeOpen };
}

export function uninstallFakeIndexedDb(): void {
  sharedDb = null;
  delete (globalThis as unknown as { indexedDB?: unknown }).indexedDB;
}
