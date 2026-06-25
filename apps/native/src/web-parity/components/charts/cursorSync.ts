// Native parity port of web/src/components/charts/cursorSync.ts.
// This module is non-visual state logic; React Native can preserve the web
// external-store behavior without DOM, Recharts, or browser APIs.

import {useCallback, useSyncExternalStore} from 'react';

export type CursorSyncValue = string | number | null;

interface Store {
  positions: Map<string, CursorSyncValue>;
  listeners: Set<() => void>;
}

const store: Store = {
  positions: new Map<string, CursorSyncValue>(),
  listeners: new Set<() => void>(),
};

function emit(): void {
  store.listeners.forEach(listener => {
    listener();
  });
}

export function setCursorSyncPosition(
  syncId: string,
  value: CursorSyncValue,
): void {
  const current = store.positions.get(syncId) ?? null;
  if (current === value) {
    return;
  }

  if (value == null) {
    store.positions.delete(syncId);
  } else {
    store.positions.set(syncId, value);
  }

  emit();
}

export function getCursorSyncPosition(syncId: string): CursorSyncValue {
  return store.positions.get(syncId) ?? null;
}

export function clearCursorSync(syncId: string): void {
  if (!store.positions.has(syncId)) {
    return;
  }

  store.positions.delete(syncId);
  emit();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

export function useCursorSyncPosition(
  syncId: string | undefined,
): CursorSyncValue {
  const getSnapshot = useCallback((): CursorSyncValue => {
    if (!syncId) {
      return null;
    }

    return store.positions.get(syncId) ?? null;
  }, [syncId]);
  const getServerSnapshot = useCallback((): CursorSyncValue => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function _resetCursorSyncStore(): void {
  store.positions.clear();
  store.listeners.clear();
}
