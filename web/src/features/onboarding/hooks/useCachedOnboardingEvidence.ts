import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Query, QueryClient } from '@tanstack/react-query'

import { safeArray } from '@/lib/safeArray'
import type { AppSettings, FleetTelemetryCoverageResponse, LiveSignalsResponse } from '@/api/types'

/**
 * Reactive, read-only evidence for task-specific onboarding (HELP-01).
 *
 * ## Why this exists
 *
 * The first implementation read the query cache inside
 * `useMemo(..., [queryClient, root])`. Both dependencies are stable for the
 * lifetime of the app, so the memo computed **once at mount and never again**:
 * every count froze at whatever was cached during the first render — normally
 * nothing. Four of the five onboarding tasks could therefore never fire, and
 * the one that did (`link-vehicle`) only worked because it reads `useVehicles()`
 * through the ordinary hook. The bug was invisible because "no hint" is also
 * the correct output in most situations.
 *
 * The fix is a real subscription to the `QueryCache` via `useSyncExternalStore`,
 * so evidence re-decodes whenever a query is added, updated or removed.
 *
 * ## Two invariants
 *
 * 1. **Read-only.** Nothing here fetches. Onboarding must never become a
 *    background load on every route for every user — and "only what this page
 *    already loaded" is an honest proxy for "relevant to what the user is
 *    doing right now".
 * 2. **Unknown stays unknown.** Every accessor returns `undefined` when the
 *    cache holds no observation, and `selectOnboardingTask` treats unknown as
 *    "do not interrupt". A pending query, an errored query with no data, and a
 *    query that was never mounted are all indistinguishable from the user's
 *    point of view, so all three read as unknown rather than as zero.
 *
 * ## Decoding
 *
 * Each accessor decodes the **raw** cached value exactly as the owning domain
 * hook decodes it, because `query.state.data` is the pre-`select` value:
 *
 * | Source                | Owning hook                | Raw → decoded            |
 * |-----------------------|----------------------------|--------------------------|
 * | `['automations']`     | `useAutomations`           | `select: safeArray`      |
 * | `['notification-channels']` | `useNotificationChannels` | `select: safeArray` |
 * | `['charging',…]`      | `useChargingSessionsPaginated` (the `/charging` page) | `select: safeArray` |
 * | `['charging-sessions',…]` | `useChargingSessions` / `…History` | `select: safeArray` |
 * | `['drives',…]`        | `useDrives`                | raw `Drive[]`            |
 * | `['settings']`        | `useSettings`              | raw `AppSettings`        |
 * | `['typed-signals','live',id]` | `useLiveSignals`   | normalised in `queryFn`  |
 * | `['fleet-telemetry','coverage']` | `useFleetTelemetryCoverage` | normalised in `queryFn` |
 *
 * Charging deliberately reads BOTH roots — see `readChargingSessionCount`.
 * Guessing which one was "the real" root is what kept the charging task dead
 * through two passes.
 */

/** Cache events that can change decoded evidence. */
const RELEVANT_EVENTS = new Set(['added', 'removed', 'updated'])

/**
 * Monotonic revision of the query cache.
 *
 * `useSyncExternalStore` needs a snapshot that is cheap, referentially stable
 * between notifications, and different after one. A counter satisfies all
 * three; hashing the cache contents on every read would not be cheap, and
 * returning the cache object itself would not change identity on update.
 */
function useQueryCacheRevision(queryClient: QueryClient): number {
  const revisionRef = useRef(0)

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (!RELEVANT_EVENTS.has(event.type)) return
        revisionRef.current += 1
        onStoreChange()
      }),
    [queryClient],
  )

  const getSnapshot = useCallback(() => revisionRef.current, [])
  // Server snapshot is the same counter: this hook only ever runs in the
  // browser, and returning a constant would make hydration disagree.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Every cached query under `root` that has actually observed a value. */
function observedQueries(queryClient: QueryClient, root: string): Query[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: [root] })
    .filter((query) => query.state.data !== undefined)
}

/**
 * Largest observed list length under a key root, or `undefined` when nothing
 * has been observed.
 *
 * Largest wins because several scoped variants of the same list coexist in the
 * cache (all-vehicles, per-vehicle, per-window). A narrow window that returned
 * zero rows must not be read as "the user has none" — that would fire a
 * "create your first automation" hint at someone with fifty automations who
 * happened to filter them all out.
 *
 * `arrayOnly` excludes sibling detail queries that share the root but cache an
 * object (`['charging-sessions', id]`). For roots whose owning hook applies
 * `select: safeArray`, a non-array raw value legitimately decodes to an empty
 * list, so those roots pass `arrayOnly: false` and go through `safeArray`.
 */
function observedMaxLength(
  queryClient: QueryClient,
  root: string,
  options: { arrayOnly: boolean },
): number | undefined {
  const entries = observedQueries(queryClient, root).filter((query) =>
    options.arrayOnly ? Array.isArray(query.state.data) : true,
  )
  if (entries.length === 0) return undefined
  return entries.reduce((max, query) => {
    const decoded = options.arrayOnly
      ? (query.state.data as unknown[])
      : safeArray(query.state.data as unknown[] | unknown)
    return Math.max(max, decoded.length)
  }, 0)
}

/** Exact-key lookup (no prefix match), decoded through `safeArray`. */
function observedExactListLength(
  queryClient: QueryClient,
  key: readonly unknown[],
): number | undefined {
  const query = queryClient
    .getQueryCache()
    .findAll({ queryKey: key, exact: true })
    .find((candidate) => candidate.state.data !== undefined)
  if (!query) return undefined
  return safeArray(query.state.data as unknown[] | unknown).length
}

/**
 * Combine observations with "max-defined" semantics: `undefined` only when
 * NEITHER source was observed. A root that has not loaded must not drag a
 * root that has down to zero — that is the same unknown-read-as-zero mistake
 * the whole module exists to avoid, just spread across two cache keys.
 */
function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((v): v is number => typeof v === 'number')
  return defined.length === 0 ? undefined : Math.max(...defined)
}

/**
 * Charging sessions live under TWO unrelated cache roots, because two hooks
 * fetch them:
 *
 *   - `['charging', vehicleId, start, end, limit, offset]` —
 *     `useChargingSessionsPaginated`, which is what the **`/charging` page
 *     itself** uses. This is the root that matters for the charging task.
 *   - `['charging-sessions', …]` — `useChargingSessions` / `…History`, used by
 *     Energy Ledger, Charger Health and several dashboard widgets.
 *
 * Reading only one of them is how this task stayed dead: an earlier pass
 * "corrected" the root from `charging` to `charging-sessions` on the
 * assumption that no hook wrote the former, when in fact the former is the
 * only one the charging page populates. Both are read now, and the comment
 * names the hooks so the next reader can verify rather than assume.
 *
 * Several widgets also cache session arrays under `['charging', id, '<tag>']`;
 * those are legitimate observations of the same underlying list, so the
 * largest wins exactly as it does within a single root.
 */
function readChargingSessionCount(queryClient: QueryClient): number | undefined {
  return maxDefined(
    observedMaxLength(queryClient, 'charging', { arrayOnly: true }),
    observedMaxLength(queryClient, 'charging-sessions', { arrayOnly: true }),
  )
}

/**
 * Has the user configured an electricity price?
 *
 * `base_cost_per_kwh` is the value the charging-cost task's action actually
 * changes (Settings → electricity price), so it is the only honest signal for
 * "is this task still outstanding". A zero or missing rate means charging rows
 * are written without a cost, which is exactly the symptom the hint explains.
 */
function readTariffConfigured(queryClient: QueryClient): boolean | undefined {
  const query = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['settings'], exact: true })
    .find((candidate) => candidate.state.data !== undefined)
  if (!query) return undefined
  const settings = query.state.data as Partial<AppSettings> | null | undefined
  if (settings == null || typeof settings !== 'object') return undefined
  const rate = settings.base_cost_per_kwh
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return false
  return rate > 0
}

/**
 * Is live telemetry actually flowing?
 *
 * Two independent sources, in priority order:
 *
 * 1. **Observation** — a cached `/signals/{id}/live` response. `count > 0`
 *    means signals are arriving right now; `count === 0` means the page asked
 *    and got nothing. Direct evidence beats configuration.
 * 2. **Configuration** — the fleet-telemetry coverage map. Any destination
 *    with a non-zero field total means telemetry routing is configured.
 *
 * Returns `undefined` when neither has been observed. The previous code
 * hard-coded `true` here, which silently disabled the telemetry task
 * permanently — technically "fail closed", but by way of a lie in the context
 * object rather than an honest unknown.
 */
function readLiveTelemetry(queryClient: QueryClient): boolean | undefined {
  const liveQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['typed-signals', 'live'] })
    .filter((query) => query.state.data !== undefined)

  if (liveQueries.length > 0) {
    return liveQueries.some((query) => {
      const live = query.state.data as Partial<LiveSignalsResponse> | null | undefined
      if (live == null || typeof live !== 'object') return false
      if (typeof live.count === 'number' && live.count > 0) return true
      // `count` is server-supplied; fall back to the normalised map so a
      // response that omits the counter is still read correctly.
      return Object.keys(live.signals ?? {}).length > 0
    })
  }

  const coverage = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['fleet-telemetry', 'coverage'], exact: true })
    .find((query) => query.state.data !== undefined)
  if (!coverage) return undefined

  const data = coverage.state.data as Partial<FleetTelemetryCoverageResponse> | null | undefined
  if (data == null || typeof data !== 'object') return undefined
  const totals = data.destination_totals ?? {}
  return Object.values(totals).some((total) => typeof total === 'number' && total > 0)
}

/** Everything the task predicates need, decoded from the cache. */
export interface CachedOnboardingEvidence {
  driveCount: number | undefined
  chargingSessionCount: number | undefined
  automationCount: number | undefined
  notificationChannelCount: number | undefined
  hasLiveTelemetry: boolean | undefined
  hasElectricityTariff: boolean | undefined
}

/**
 * Subscribe to the query cache and decode onboarding evidence from it.
 *
 * Re-runs on every relevant cache mutation, so a list that arrives *after* the
 * host mounted is picked up on the very next render.
 */
export function useCachedOnboardingEvidence(): CachedOnboardingEvidence {
  const queryClient = useQueryClient()
  const revision = useQueryCacheRevision(queryClient)

  return useMemo(
    () => ({
      // `revision` is the whole point of this dependency array: the cache is
      // mutable and `queryClient` never changes identity, so without it this
      // memo would freeze exactly as the original implementation did.
      driveCount: observedMaxLength(queryClient, 'drives', { arrayOnly: true }),
      chargingSessionCount: readChargingSessionCount(queryClient),
      automationCount: observedExactListLength(queryClient, ['automations']),
      notificationChannelCount: observedExactListLength(queryClient, [
        'notification-channels',
      ]),
      hasLiveTelemetry: readLiveTelemetry(queryClient),
      hasElectricityTariff: readTariffConfigured(queryClient),
    }),
    [queryClient, revision],
  )
}
