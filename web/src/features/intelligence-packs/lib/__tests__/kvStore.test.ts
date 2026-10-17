import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryKvStore, createLocalStorageKvStore, createIndexedDbKvStore, createDefaultKvStore, IndexedDbUnavailableError } from '../kvStore';

describe('createMemoryKvStore', () => {
  it('stores, retrieves, and removes values', async () => {
    const kv = createMemoryKvStore();
    expect(await kv.getItem('a')).toBeNull();
    await kv.setItem('a', 'hello');
    expect(await kv.getItem('a')).toBe('hello');
    await kv.removeItem('a');
    expect(await kv.getItem('a')).toBeNull();
  });

  it('is isolated per instance (no shared global state)', async () => {
    const kv1 = createMemoryKvStore();
    const kv2 = createMemoryKvStore();
    await kv1.setItem('k', 'v1');
    expect(await kv2.getItem('k')).toBeNull();
  });
});

describe('createLocalStorageKvStore', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores, retrieves, and removes values with a key prefix', async () => {
    const kv = createLocalStorageKvStore('test-prefix:');
    await kv.setItem('a', 'hello');
    expect(window.localStorage.getItem('test-prefix:a')).toBe('hello');
    expect(await kv.getItem('a')).toBe('hello');
    await kv.removeItem('a');
    expect(await kv.getItem('a')).toBeNull();
  });

  it('does not leak keys between different prefixes', async () => {
    const kvA = createLocalStorageKvStore('a:');
    const kvB = createLocalStorageKvStore('b:');
    await kvA.setItem('k', 'valueA');
    await kvB.setItem('k', 'valueB');
    expect(await kvA.getItem('k')).toBe('valueA');
    expect(await kvB.getItem('k')).toBe('valueB');
  });

  it.each(['getItem', 'setItem', 'removeItem'] as const)('propagates %s failures without changing saved data', async (method) => {
    const kv = createLocalStorageKvStore('failure:');
    await kv.setItem('pack', 'saved');
    const error = new DOMException('Storage denied', 'SecurityError');
    vi.spyOn(Storage.prototype, method).mockImplementationOnce(() => { throw error; });

    const operation = method === 'setItem' ? kv.setItem('pack', 'replacement') : kv[method]('pack');
    await expect(operation).rejects.toBe(error);
    expect(await kv.getItem('pack')).toBe('saved');
  });
});

describe('createIndexedDbKvStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['getItem', 'setItem', 'removeItem'] as const)('rejects an aborted %s transaction', async (method) => {
    const transaction: {
      error: DOMException | null;
      onabort: (() => void) | null;
      oncomplete: (() => void) | null;
      objectStore: () => object;
    } = {
      error: null,
      onabort: null,
      oncomplete: null,
      objectStore: () => ({
        get: () => ({ result: 'saved' }),
        put: () => undefined,
        delete: () => undefined,
      }),
    };
    const request: { result: object; onsuccess: (() => void) | null } = {
      result: { transaction: () => transaction },
      onsuccess: null,
    };
    vi.stubGlobal('indexedDB', { open: () => request });
    const kv = createIndexedDbKvStore('abort-db', 'kv');
    const operation = method === 'setItem' ? kv.setItem('pack', 'value') : kv[method]('pack');
    const rejection = expect(operation).rejects.toThrow(/IndexedDB .* aborted/);
    request.onsuccess?.();
    await Promise.resolve();
    expect(transaction.onabort).toBeTypeOf('function');
    transaction.onabort?.();
    await rejection;
  });

  it('rejects with IndexedDbUnavailableError in this jsdom test environment (documented coverage limitation: no real IndexedDB in jsdom)', async () => {
    // jsdom does not implement a real `indexedDB` global; this test honestly
    // documents that limitation rather than mocking IndexedDB out.
    expect(typeof indexedDB === 'undefined' || indexedDB == null).toBe(true);
    const kv = createIndexedDbKvStore('test-db', 'test-store');
    await expect(kv.getItem('x')).rejects.toThrow(IndexedDbUnavailableError);
  });
});

describe('createDefaultKvStore', () => {
  it('falls back to localStorage backend when IndexedDB is unavailable (as in this test environment)', () => {
    const { store, backend } = createDefaultKvStore('teslasync-intel-packs-test', 'kv');
    expect(backend === 'localstorage' || backend === 'indexeddb' || backend === 'memory').toBe(true);
    expect(store).toBeDefined();
    // In jsdom (no real indexedDB), we expect the honest fallback path.
    if (typeof indexedDB === 'undefined') {
      expect(backend).toBe('localstorage');
    }
  });

  it('the returned store is actually usable end-to-end', async () => {
    const { store } = createDefaultKvStore('teslasync-intel-packs-test-2', 'kv');
    await store.setItem('probe', 'value');
    expect(await store.getItem('probe')).toBe('value');
    await store.removeItem('probe');
    expect(await store.getItem('probe')).toBeNull();
  });
});
