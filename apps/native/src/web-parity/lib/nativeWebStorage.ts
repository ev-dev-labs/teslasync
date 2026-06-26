// Native-safe synchronous key/value storage — parity substitute for the browser
// `window.localStorage` / `window.sessionStorage` used by web/src/lib/draftIndex.ts
// and web/src/hooks/useFormDraft.ts.
//
// React Native exposes only the asynchronous AsyncStorage, which cannot back the
// synchronous read/write the source modules perform (lazy useState init, the
// getDrafts localStorage scan, the synchronous flush). To keep those code paths
// structurally identical, draft state persists for the current app process in an
// in-memory, insertion-ordered store that mirrors the slice of the Web Storage
// API the source actually touches: getItem / setItem / removeItem plus key(i) and
// length (needed by draftIndex.getDrafts' envelope scan).
//
// The string keys (`teslasync:draft:v{version}:{key}`,
// `teslasync:draft-index:v1`) are preserved verbatim, so a future
// AsyncStorage-backed synchronous cache can drop in unchanged.

/** The subset of the DOM `Storage` interface the parity ports rely on. */
export interface NativeKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

type StorageKind = 'local' | 'session';

function createMemoryStorage(): NativeKeyValueStorage {
  // Map preserves insertion order, so key(i) is stable across the lifetime of a
  // process — matching how the browser enumerates localStorage keys.
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    key(index: number): string | null {
      if (index < 0 || index >= store.size) {
        return null;
      }
      let i = 0;
      for (const k of store.keys()) {
        if (i === index) {
          return k;
        }
        i += 1;
      }
      return null;
    },
    get length(): number {
      return store.size;
    },
  };
}

// Two process-scoped singletons mirror the browser's two distinct backends.
// `useFormDraft` writes envelopes into `local` (or `session`); `draftIndex`
// reads/scans `local`, so both MUST share the same `local` instance for the
// crash-recovery surface to find unregistered envelopes.
const localStore = createMemoryStorage();
const sessionStore = createMemoryStorage();

/**
 * Returns the process-scoped native-safe storage for the requested backend.
 * Never returns null (the browser `getStorage` could, when Storage was
 * disabled); callers keep their null-guards for source parity, but the native
 * store is always present.
 */
export function getNativeStorage(kind: StorageKind): NativeKeyValueStorage {
  return kind === 'session' ? sessionStore : localStore;
}
