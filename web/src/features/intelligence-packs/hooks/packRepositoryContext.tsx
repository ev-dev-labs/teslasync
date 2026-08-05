/**
 * Provides a `PackRepository` instance to the marketplace feature's hooks.
 *
 * Defaults to the real, feature-detecting `createDefaultKvStore()` (see
 * `lib/kvStore.ts`) so the app gets IndexedDB when available and an honest,
 * documented localStorage/in-memory fallback otherwise. Tests (and any
 * consumer that wants full isolation) can wrap a subtree in
 * `<PackRepositoryProvider repository={createInMemoryPackRepository()}>`
 * to swap in the in-memory adapter — this is the ONLY supported way to
 * inject a different repository; there is no hidden global singleton.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createDefaultKvStore, type StorageBackend } from '../lib/kvStore';
import { createPackRepository, type PackRepository } from '../lib/packRepository';

const DB_NAME = 'teslasync-intelligence-packs';
const STORE_NAME = 'kv';

export interface PackRepositoryContextValue {
  repository: PackRepository;
  backend: StorageBackend;
}

const PackRepositoryContext = createContext<PackRepositoryContextValue | null>(null);

export interface PackRepositoryProviderProps {
  children: ReactNode;
  /** Override for tests / storybook-style isolation. Defaults to the real feature-detecting store. */
  repository?: PackRepository;
  backend?: StorageBackend;
}

export function PackRepositoryProvider({ children, repository, backend }: PackRepositoryProviderProps) {
  const value = useMemo<PackRepositoryContextValue>(() => {
    if (repository) return { repository, backend: backend ?? 'memory' };
    const { store, backend: resolvedBackend } = createDefaultKvStore(DB_NAME, STORE_NAME);
    return { repository: createPackRepository(store), backend: resolvedBackend };
  }, []);

  return <PackRepositoryContext.Provider value={value}>{children}</PackRepositoryContext.Provider>;
}

/**
 * Access the repository + which storage backend is actually active. Falls
 * back to a lazily-created default instance if no `PackRepositoryProvider`
 * is mounted (keeps standalone hook usage/tests simple), but the app's
 * page should always mount the provider so all hooks share one instance.
 */
let fallbackContextValue: PackRepositoryContextValue | null = null;
function getFallbackContextValue(): PackRepositoryContextValue {
  if (!fallbackContextValue) {
    const { store, backend } = createDefaultKvStore(DB_NAME, STORE_NAME);
    fallbackContextValue = { repository: createPackRepository(store), backend };
  }
  return fallbackContextValue;
}

export function usePackRepositoryContext(): PackRepositoryContextValue {
  const ctx = useContext(PackRepositoryContext);
  return ctx ?? getFallbackContextValue();
}
