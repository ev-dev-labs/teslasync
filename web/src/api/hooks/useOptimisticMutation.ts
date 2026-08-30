import {
  useMutation,
  useQueryClient,
  type NetworkMode,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

/**
 * Shared optimistic-mutation helper.
 * Wraps `useMutation` with the standard TanStack Query optimistic-update
 * lifecycle so individual hooks don't have to reinvent the snapshot /
 * rollback dance and so the rules stay uniform across the codebase.
 * Lifecycle managed by this helper:
 *   1. `onMutate`: cancel in-flight queries on every affected key so a
 *      stale background refetch can't clobber the optimistic write,
 *      capture a snapshot of every matching cache entry, then apply the
 *      caller-supplied `updater` to each entry.
 *   2. `onError`: restore the snapshot for every previously-modified entry
 *      so the UI snaps back to the prior state.
 *   3. `onSettled`: invalidate every affected key (broadcasting across
 *      tabs when `broadcast: true`) so the server's truth eventually wins,
 *      regardless of success or error.
 * The helper accepts an optional caller-supplied `onMutate` callback for
 * hook-specific side effects (analytics, haptic feedback, modal cleanup).
 * It runs AFTER the optimistic write has been applied so React state can
 * already see the new value when it fires.
 * `queryKeys` may be a static array OR a function of `vars` — use the
 * function form when the affected cache keys depend on the mutation
 * payload (e.g. `['saved-views', route]` where route comes from `vars`).
 * Internally the helper uses `getQueriesData` + `setQueryData` so a single
 * key prefix updates every matching child cache (e.g. one mark-read on
 * `['notification-logs']` updates every filtered list query under that
 * prefix simultaneously). Existing-cache-only — if no entries exist for a
 * prefix, no fresh entry is fabricated.
 */

export type OptimisticUpdater<TVariables, TPrev> = (
  prev: TPrev | undefined,
  vars: TVariables,
  key: QueryKey,
) => TPrev | undefined;

export interface OptimisticContext<TPrev> {
  /** Pre-mutation snapshots of every cache entry the helper modified. */
  snapshots: Array<[QueryKey, TPrev | undefined]>;
  /** Resolved keys for this invocation — kept in context so onSettled can
   *  invalidate the same set even when `queryKeys` is a function. */
  keys: QueryKey[];
}

export interface UseOptimisticMutationOptions<TData, TVariables, TPrev> {
  /** Performs the actual server request. Same shape as TanStack Query's. */
  mutationFn: (vars: TVariables) => Promise<TData>;
  /** Use `always` for live-only writes so offline calls fail immediately
   * instead of entering TanStack Query's paused mutation queue. */
  networkMode?: NetworkMode;
  /** Cache keys (prefixes) the mutation affects. Static array or
   *  variables-derived function. Each is treated as a prefix — every
   *  matching child cache is updated and invalidated. */
  queryKeys: QueryKey[] | ((vars: TVariables) => QueryKey[]);
  /** Pure function that maps `(prev, vars, key) -> next`. Return `prev`
   *  unchanged (or `undefined`) to skip the optimistic write for that
   *  cache entry. */
  updater: OptimisticUpdater<TVariables, TPrev>;
  /** When true, invalidations also fire over the broadcast channel so
   *  other open tabs refetch as well. Defaults to false. */
  broadcast?: boolean;
  /**
   * Optional hook-specific `onMutate` callback. Runs AFTER the snapshot
   * + cache write — use for analytics, haptics, modal cleanup, or any
   * side effect that should happen immediately rather than on the
   * server round-trip.
   */
  onMutate?: (vars: TVariables) => void;
  onSuccess?: (
    data: TData,
    vars: TVariables,
    ctx: OptimisticContext<TPrev>,
  ) => void;
  onError?: (
    err: Error,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
  onSettled?: (
    data: TData | undefined,
    err: Error | null,
    vars: TVariables,
    ctx: OptimisticContext<TPrev> | undefined,
  ) => void;
}

function resolveKeys<TVariables>(
  spec: QueryKey[] | ((vars: TVariables) => QueryKey[]),
  vars: TVariables,
): QueryKey[] {
  return typeof spec === 'function' ? spec(vars) : spec;
}

function invalidate(qc: QueryClient, key: QueryKey, broadcast: boolean): void {
  if (broadcast) {
    invalidateAndBroadcast(qc, { queryKey: key });
  } else {
    void qc.invalidateQueries({ queryKey: key });
  }
}

export function useOptimisticMutation<TData, TVariables, TPrev = unknown>(
  opts: UseOptimisticMutationOptions<TData, TVariables, TPrev>,
): UseMutationResult<TData, Error, TVariables, OptimisticContext<TPrev>> {
  const qc = useQueryClient();
  const broadcast = opts.broadcast ?? false;

  return useMutation<TData, Error, TVariables, OptimisticContext<TPrev>>({
    mutationFn: opts.mutationFn,
    networkMode: opts.networkMode,
    onMutate: async (vars) => {
      const keys = resolveKeys(opts.queryKeys, vars);
      const snapshots: Array<[QueryKey, TPrev | undefined]> = [];
      for (const key of keys) {
        await qc.cancelQueries({ queryKey: key });
        const matches = qc.getQueriesData<TPrev>({ queryKey: key });
        for (const [matchKey, prev] of matches) {
          snapshots.push([matchKey, prev]);
          qc.setQueryData<TPrev>(matchKey, (old) =>
            opts.updater(old, vars, matchKey),
          );
        }
      }
      opts.onMutate?.(vars);
      return { snapshots, keys };
    },
    onError: (err, vars, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => {
        qc.setQueryData(key, prev);
      });
      opts.onError?.(err, vars, ctx);
    },
    onSettled: (data, err, vars, ctx) => {
      const keys = ctx?.keys ?? resolveKeys(opts.queryKeys, vars);
      for (const key of keys) {
        invalidate(qc, key, broadcast);
      }
      opts.onSettled?.(data, err, vars, ctx);
    },
    onSuccess: opts.onSuccess
      ? (data, vars, ctx) => opts.onSuccess?.(data, vars, ctx)
      : undefined,
  });
}
