// Native parity port of web/src/components/charts/ChartTimeRangeContext.tsx.
// React Native chart shims do not have Recharts' built-in sync bus, so this
// module preserves the web context API and persistent cursor store for native
// callers that can provide active x-axis labels from touch/gesture events.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type CursorSyncValue = string | number | null;

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

function setCursorSyncPosition(
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

function clearCursorSync(syncId: string): void {
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

function useCursorSyncPosition(
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

/**
 * Shared chart-sync context with persistent cursor sync.
 *
 * Web charts pass `syncId` and `syncMethod` into Recharts. Native chart parity
 * keeps the same values available to chart shims and persists the last active
 * x value so synchronized reference-line affordances can survive touch end.
 */
export interface ChartSyncContextValue {
  syncId: string;
  syncMethod: 'index' | 'value';
}

const Ctx = createContext<ChartSyncContextValue | null>(null);

export interface ChartTimeRangeProviderProps {
  syncId: string;
  syncMethod?: 'index' | 'value';
  children: ReactNode;
}

export function ChartTimeRangeProvider({
  syncId,
  syncMethod = 'index',
  children,
}: ChartTimeRangeProviderProps) {
  const value = useMemo<ChartSyncContextValue>(
    () => ({syncId, syncMethod}),
    [syncId, syncMethod],
  );

  useEffect(() => {
    return () => {
      clearCursorSync(syncId);
    };
  }, [syncId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChartSync(): ChartSyncContextValue | null {
  return useContext(Ctx);
}

export interface SyncedCursorProps {
  syncId?: string;
  syncMethod?: 'index' | 'value';
  onMouseMove?: (state: RechartsMouseState | null) => void;
}

interface RechartsMouseState {
  activeLabel?: string | number;
}

export function useSyncedCursor(): SyncedCursorProps {
  const ctx = useChartSync();
  const syncId = ctx?.syncId;
  const onMouseMove = useCallback(
    (state: RechartsMouseState | null) => {
      if (!syncId) {
        return;
      }

      const next = state?.activeLabel ?? null;
      setCursorSyncPosition(syncId, next);
    },
    [syncId],
  );

  if (!ctx) {
    return {};
  }

  return {
    syncId: ctx.syncId,
    syncMethod: ctx.syncMethod,
    onMouseMove,
  };
}

export function useSyncedReferenceLineX(): CursorSyncValue {
  const ctx = useChartSync();
  return useCursorSyncPosition(ctx?.syncId);
}
