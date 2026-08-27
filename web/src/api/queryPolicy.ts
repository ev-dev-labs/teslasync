/**
 * @module api/queryPolicy
 *
 * Single source of truth for TanStack Query caching + refetch policy,
 * expressed as **data volatility** rather than as per-hook magic numbers.
 *
 * Before this module every hook picked its own `staleTime` from
 * `lib/constants`, and `gcTime`, `retry` and `refetchOn*` were left to the
 * client defaults or hand-tuned. The result was that two hooks reading the
 * same underlying table could disagree about how long a value is trustworthy,
 * and nothing prevented a 3 s `refetchInterval` sitting on top of a 60 s
 * `staleTime` (a request storm that never serves anything the cache did not
 * already have).
 *
 * Four tiers, matching how the backend actually produces the data:
 *
 * | Tier          | Backing source                                   | Changes |
 * |---------------|--------------------------------------------------|---------|
 * | `live`        | signal.Store / Redis live state, SSE-pushed        | seconds |
 * | `operational` | drives, charging sessions, alerts, queues          | minutes |
 * | `historical`  | signal_log, continuous aggregates, analytics       | hours   |
 * | `reference`   | vehicle list, enums, capability + config catalogs  | rarely  |
 *
 * ## Storm safety
 *
 * {@link queryPolicy} enforces two invariants on the merged result:
 *
 *   1. `refetchInterval` (when a number) is clamped to at least
 *      {@link MIN_REFETCH_INTERVAL_MS} so no caller can schedule a sub-second
 *      poll loop.
 *   2. `refetchInterval` is never shorter than the tier's `staleTime`: a poll
 *      that fires while the cache is still fresh is either a no-op or a
 *      duplicate fetch. Violations are clamped up to `staleTime`.
 *
 * `refetchIntervalInBackground` stays `false` on every tier — the app-wide
 * hidden-tab pause contract in `api/queryClient.ts` is not weakened here.
 *
 * ## Retry is NOT emitted (ownership belongs to the QueryClient)
 *
 * TanStack Query resolves options as `QueryClient defaults < per-query
 * options`. Anything this module puts in the returned object therefore
 * **beats** the ambient client and cannot be turned off from the outside.
 * Emitting `retry` here made every adopting hook un-configurable: a test (or
 * a future runtime kill-switch) that sets `retry: false` on the QueryClient
 * was silently ignored, so a failing request kept retrying with backoff and
 * the error surface never rendered inside the assertion window.
 *
 * Retry is a *transport* concern that the client already owns and that
 * callers legitimately need to override per environment. {@link queryPolicy}
 * therefore emits `retry` / `retryDelay` **only when the caller passes them
 * explicitly**; otherwise the keys are absent and the ambient client wins.
 * The per-tier intent is still declared in {@link QUERY_POLICIES} and can be
 * opted into deliberately with {@link retryPolicy}.
 */

import { keepPreviousData } from '@tanstack/react-query'

/** Volatility class of the data behind a query. */
export type QueryVolatility = 'live' | 'operational' | 'historical' | 'reference'

/**
 * Cache + refetch options this module owns unconditionally. Deliberately
 * structural (not `Pick<UseQueryOptions<...>>`) so it can be spread into
 * `useQuery`, `useInfiniteQuery` and `prefetchQuery` alike without generic
 * gymnastics.
 *
 * Note the absence of `retry` / `retryDelay`: see the module comment.
 */
export interface QueryCachePolicy {
  staleTime: number
  gcTime: number
  refetchOnWindowFocus: boolean
  refetchOnReconnect: boolean
  refetchOnMount: boolean | 'always'
  refetchInterval: number | false
  refetchIntervalInBackground: false
}

/**
 * Declared per-tier retry intent. Not emitted by {@link queryPolicy} — spread
 * {@link retryPolicy} explicitly when a call site genuinely needs to pin it
 * above the ambient QueryClient.
 */
export interface QueryRetryPolicy {
  retry: number
  retryDelay: (attemptIndex: number) => number
}

/** Full declared tier: cache/refetch behaviour plus the retry intent. */
export type QueryPolicy = QueryCachePolicy & QueryRetryPolicy

/** Nothing may poll faster than this, regardless of tier or override. */
export const MIN_REFETCH_INTERVAL_MS = 1_000

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/**
 * Exponential backoff shared by every tier, capped at 30 s so a long outage
 * does not leave a query retrying every few milliseconds nor stranded for
 * minutes after recovery.
 */
export function policyRetryDelay(attemptIndex: number): number {
  return Math.min(2 * SECOND * 2 ** attemptIndex, 30 * SECOND)
}

/**
 * Canonical per-tier policy. Exported so tests and the audit tooling can
 * assert on the values without instantiating a QueryClient.
 */
export const QUERY_POLICIES: Readonly<Record<QueryVolatility, QueryPolicy>> = {
  /**
   * Current vehicle state. SSE is the primary transport (see
   * `hooks/useLiveRecovery`), so the interval here is a *fallback* poll, not
   * the main path — 15 s rather than the 3 s several hooks used to hard-code.
   */
  live: {
    staleTime: 5 * SECOND,
    gcTime: 5 * MINUTE,
    retry: 1,
    retryDelay: policyRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    refetchInterval: 15 * SECOND,
    refetchIntervalInBackground: false,
  },
  /**
   * Records the backend closes on a state transition (drives, charging
   * sessions, alerts, queue depth). Invalidation on SSE/mutation is the
   * intended refresh path; there is no ambient poll.
   */
  operational: {
    staleTime: 30 * SECOND,
    gcTime: 15 * MINUTE,
    retry: 2,
    retryDelay: policyRetryDelay,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: true,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  },
  /**
   * Closed history and continuous aggregates. Immutable once written apart
   * from data-repair edits, which invalidate explicitly.
   */
  historical: {
    staleTime: 5 * MINUTE,
    gcTime: 30 * MINUTE,
    retry: 2,
    retryDelay: policyRetryDelay,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  },
  /**
   * Catalogs and configuration. Long `gcTime` keeps them resident across
   * route changes so navigation does not re-fetch the vehicle list.
   */
  reference: {
    staleTime: 30 * MINUTE,
    gcTime: 24 * HOUR,
    retry: 2,
    retryDelay: policyRetryDelay,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  },
}

/**
 * Clamp a caller-supplied interval so it can never out-run the tier's own
 * cache window. Returns `false` untouched (polling disabled) and drops
 * non-finite / non-positive values to `false` rather than letting `NaN` reach
 * the scheduler.
 */
export function clampRefetchInterval(
  interval: number | false | undefined,
  staleTime: number,
): number | false {
  if (interval === false || interval == null) return false
  if (!Number.isFinite(interval) || interval <= 0) return false
  return Math.max(interval, MIN_REFETCH_INTERVAL_MS, staleTime)
}

export type QueryPolicyOverrides = Partial<Omit<QueryPolicy, 'refetchIntervalInBackground'>>

/**
 * The shape {@link queryPolicy} actually emits: the cache/refetch policy, plus
 * `retry` / `retryDelay` **only** when the caller asked for them.
 */
export type ResolvedQueryPolicy = QueryCachePolicy & Partial<QueryRetryPolicy>

/**
 * The declared retry intent for a tier, for call sites that deliberately want
 * to pin retry above the ambient QueryClient.
 *
 * ```ts
 * useQuery({
 *   ...queryPolicy('operational'),
 *   ...retryPolicy('operational'), // opt in: now un-overridable by the client
 * })
 * ```
 *
 * Prefer leaving it out. The QueryClient default is the layer operators and
 * tests configure; pinning it here makes the query immune to that.
 */
export function retryPolicy(volatility: QueryVolatility): QueryRetryPolicy {
  const { retry, retryDelay } = QUERY_POLICIES[volatility]
  return { retry, retryDelay }
}

/**
 * Resolve the options for a query of the given volatility.
 *
 * ```ts
 * useQuery({
 *   queryKey: drivingKeys.drives(vehicleId, window),
 *   queryFn: ({ signal }) => request<Drive[]>(path, { signal }),
 *   ...queryPolicy('operational'),
 * })
 * ```
 *
 * Overrides are merged on top of the tier, then re-validated: an override
 * cannot introduce a storm, and cannot turn background polling back on (that
 * requires an explicit, annotated `refetchIntervalInBackground: true` on the
 * call site, which `npm run audit:bg-polling` polices).
 *
 * `retry` / `retryDelay` are emitted **only** when present in `overrides`.
 * Omitting them keeps the key absent from the returned object, which is what
 * lets the ambient QueryClient default win — see the module comment.
 */
export function queryPolicy(
  volatility: QueryVolatility,
  overrides: QueryPolicyOverrides = {},
): ResolvedQueryPolicy {
  const base = QUERY_POLICIES[volatility]
  const staleTime = overrides.staleTime != null && Number.isFinite(overrides.staleTime) && overrides.staleTime >= 0
    ? overrides.staleTime
    : base.staleTime
  const gcTime = overrides.gcTime != null && Number.isFinite(overrides.gcTime) && overrides.gcTime > 0
    ? overrides.gcTime
    : base.gcTime

  // Spread the tier's CACHE policy only — `retry`/`retryDelay` are excluded
  // from `base` here so they can never leak in implicitly.
  const { retry: _tierRetry, retryDelay: _tierRetryDelay, ...cacheBase } = base
  const { retry: overrideRetry, retryDelay: overrideRetryDelay, ...cacheOverrides } = overrides

  const resolved: ResolvedQueryPolicy = {
    ...cacheBase,
    ...cacheOverrides,
    staleTime,
    // Evicting the cache sooner than the data is considered fresh would
    // discard a payload we still promise to serve — keep gcTime above it.
    gcTime: Math.max(gcTime, staleTime),
    refetchInterval: clampRefetchInterval(
      'refetchInterval' in overrides ? overrides.refetchInterval : base.refetchInterval,
      staleTime,
    ),
    refetchIntervalInBackground: false,
  }

  // `in` rather than `!= null`: an explicit `retry: 0` / `retry: false` is a
  // meaningful instruction and must survive.
  if ('retry' in overrides) resolved.retry = overrideRetry as number
  if ('retryDelay' in overrides) resolved.retryDelay = overrideRetryDelay

  return resolved
}

/**
 * Policy for a paginated list whose page boundaries change as the user
 * navigates. `keepPreviousData` avoids a skeleton flash between pages of the
 * SAME scope.
 *
 * It is deliberately NOT part of {@link queryPolicy}: retaining the previous
 * payload across a *scope* change (different vehicle / date range) would
 * render one vehicle's rows under another vehicle's header. Callers must
 * therefore include the scope in the query key — see `api/scope.ts` — and
 * only opt into this helper for intra-scope pagination.
 */
export function paginatedQueryPolicy(
  volatility: QueryVolatility,
  overrides: QueryPolicyOverrides = {},
): ResolvedQueryPolicy & { placeholderData: typeof keepPreviousData } {
  return { ...queryPolicy(volatility, overrides), placeholderData: keepPreviousData }
}
