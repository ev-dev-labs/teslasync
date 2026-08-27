/**
 * @module api/dataState
 *
 * Typed data-trust contract shared by every read surface in the SPA.
 *
 * The SPA renders three fundamentally different kinds of value:
 *
 *   1. a value the backend measured and we just received (`live`),
 *   2. a value we received earlier and are still showing while a refresh is
 *      in flight or has failed (`cached`),
 *   3. a value that was never measured at all (unknown).
 *
 * Historically these collapsed into "render `data ?? 0`", which is a data
 * integrity bug: an unknown battery level and a real 0 % battery level are
 * not the same fact, and a failed background refresh is not the same thing
 * as "the vehicle reported nothing".
 *
 * This module gives every consumer one vocabulary for those distinctions:
 *
 *   - {@link DataProvenance} — where the bytes came from.
 *   - {@link DataStatus} — how much the viewer should trust them right now.
 *   - {@link DataState} — the two combined with the retained payload.
 *
 * ## Non-negotiable invariants
 *
 *   - `data` is passed through **verbatim**. A refresh failure NEVER blanks
 *     retained rows; it only downgrades `status` to `'stale'` and populates
 *     `refreshError`.
 *   - `fatalError` is set **only** when there is nothing retained to show.
 *     Callers wire `fatalError` (not `error`) into full-page error states so
 *     a transient background 500 cannot wipe a populated table.
 *   - Unknown numbers surface as `null`, never `0`. Use {@link knownNumber}.
 *
 * The shape intentionally mirrors, but does not import, TanStack Query's
 * `UseQueryResult`: {@link deriveDataState} accepts a structural subset so
 * the contract is unit-testable without mounting a QueryClient, and so
 * non-query sources (SSE snapshots, derived selectors) can produce a
 * `DataState` too.
 */

/** Where a rendered value came from. Orthogonal to how fresh it is. */
export type DataProvenance =
  /** Current state from the live pipeline (SSE push or a just-completed poll). */
  | 'live'
  /** Retained client cache whose refresh has not been confirmed. */
  | 'cached'
  /** Durable history read (signal_log / drives / charging_sessions). */
  | 'historical'
  /** Derived or estimated — computed by us, not measured by the vehicle. */
  | 'inferred'
  /** Operator-corrected record produced by the data-repair workflow. */
  | 'repaired'
  /** Provenance could not be established. Never silently treated as live. */
  | 'unknown'

/**
 * How much the viewer should trust the retained payload right now.
 *
 * `stale`, `partial` and `unavailable` all still render whatever data exists.
 * Only `initial` and `initialFailure` mean "there is genuinely nothing to
 * show yet".
 */
export type DataStatus =
  /** First load has not resolved and nothing is retained. */
  | 'initial'
  /** Fresh, complete, trusted. */
  | 'ok'
  /** Retained data is on screen but the latest refresh did not succeed. */
  | 'stale'
  /** Some contributing sources are missing; what is shown is incomplete. */
  | 'partial'
  /** Source resolved and authoritatively reports that no data exists. */
  | 'unavailable'
  /** First load failed and there is nothing retained to fall back to. */
  | 'initialFailure'

/**
 * Structural subset of a TanStack Query result consumed by
 * {@link deriveDataState}. Kept minimal on purpose: any object with these
 * fields (including a hand-rolled fixture in a test) is a valid input.
 */
export interface DataStateSource<T> {
  data?: T
  error?: unknown
  isError?: boolean
  isSuccess?: boolean
  isPending?: boolean
  isLoading?: boolean
  isFetching?: boolean
  isStale?: boolean
  fetchStatus?: 'fetching' | 'paused' | 'idle'
  dataUpdatedAt?: number
  errorUpdatedAt?: number
  refetch?: () => unknown
}

export interface DeriveDataStateOptions {
  /**
   * Provenance to report when the source is healthy. Defaults to `'cached'`
   * because a plain HTTP read is a point-in-time snapshot, not a live feed.
   * Live-tier hooks pass `'live'`; history endpoints pass `'historical'`.
   */
  provenance?: DataProvenance
  /**
   * Treat the payload as incomplete even when the request succeeded — e.g. a
   * fan-out page where one of several sources returned nothing.
   */
  partial?: boolean
  /**
   * Mark a successful, non-empty-erroring response as authoritatively empty
   * (`'unavailable'`). Distinct from `partial`: the source answered, and the
   * answer is "there is none".
   */
  unavailable?: boolean
  /**
   * Age after which retained data is downgraded to `'stale'` even though no
   * refresh has failed. Use for cagg-backed reads whose backing continuous
   * aggregate refreshes on a schedule.
   */
  maxAgeMs?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

/** Trust-annotated payload. `data` is never dropped because of a refresh failure. */
export interface DataState<T> {
  /** Retained payload. Present whenever it has ever loaded successfully. */
  data: T | undefined
  /** `true` when there is something renderable, regardless of `status`. */
  hasData: boolean
  status: DataStatus
  provenance: DataProvenance
  /** A refresh is currently in flight on top of retained data. */
  isRefreshing: boolean
  /** Refresh is deferred (offline / paused) rather than failing. */
  isRefreshBlocked: boolean
  /**
   * Background refresh failure while data is retained. Render this as a
   * non-blocking warning — never as a page-level error.
   */
  refreshError: Error | null
  /**
   * Initial load failure with nothing retained. This is the only error that
   * may replace page content.
   */
  fatalError: Error | null
  /** Epoch ms of the last successful load, or `null` if never loaded. */
  updatedAt: number | null
  /** Age of the retained payload in ms, or `null` if never loaded. */
  ageMs: number | null
  /** Retry hook forwarded from the source, when it exposes one. */
  retry: (() => void) | null
}

function toError(value: unknown): Error | null {
  if (value == null) return null
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

/**
 * Collapse a query-like source into a {@link DataState}.
 *
 * Decision order — the first matching rule wins:
 *
 *   1. no retained data + error  → `initialFailure` (+ `fatalError`)
 *   2. no retained data          → `initial`
 *   3. retained data + error     → `stale` (+ `refreshError`, data kept)
 *   4. retained data + paused    → `stale` (+ `isRefreshBlocked`, data kept)
 *   5. explicit `unavailable`    → `unavailable` (data kept)
 *   6. explicit `partial`        → `partial` (data kept)
 *   7. older than `maxAgeMs`     → `stale` (data kept)
 *   8. otherwise                 → `ok`
 *
 * Rules 3–7 always keep `data`, which is what makes this contract safe to
 * wire directly into tables and charts.
 */
export function deriveDataState<T>(
  source: DataStateSource<T>,
  options: DeriveDataStateOptions = {},
): DataState<T> {
  const {
    provenance = 'cached',
    partial = false,
    unavailable = false,
    maxAgeMs,
    now = Date.now,
  } = options

  const data = source.data
  const hasData = data !== undefined
  const error = toError(source.error)
  const isPaused = source.fetchStatus === 'paused'
  const isRefreshing = hasData && (source.isFetching ?? false)
  const updatedAt =
    hasData && typeof source.dataUpdatedAt === 'number' && source.dataUpdatedAt > 0
      ? source.dataUpdatedAt
      : null
  const ageMs = updatedAt == null ? null : Math.max(0, now() - updatedAt)
  const retry = typeof source.refetch === 'function'
    ? () => { void source.refetch?.() }
    : null

  if (!hasData) {
    const failed = error != null || (source.isError ?? false)
    return {
      data: undefined,
      hasData: false,
      status: failed ? 'initialFailure' : 'initial',
      // A failed or not-yet-resolved load has established nothing about
      // provenance — claiming `live` here would be a lie.
      provenance: 'unknown',
      isRefreshing: false,
      isRefreshBlocked: isPaused,
      refreshError: null,
      fatalError: failed ? (error ?? new Error('Request failed')) : null,
      updatedAt: null,
      ageMs: null,
      retry,
    }
  }

  const base = {
    data,
    hasData: true as const,
    isRefreshing,
    isRefreshBlocked: isPaused,
    fatalError: null,
    updatedAt,
    ageMs,
    retry,
  }

  if (error != null || (source.isError ?? false)) {
    return {
      ...base,
      status: 'stale',
      // The bytes on screen are, by definition, no longer live.
      provenance: provenance === 'live' ? 'cached' : provenance,
      refreshError: error ?? new Error('Refresh failed'),
    }
  }

  if (isPaused) {
    return {
      ...base,
      status: 'stale',
      provenance: provenance === 'live' ? 'cached' : provenance,
      refreshError: null,
    }
  }

  if (unavailable) {
    return { ...base, status: 'unavailable', provenance, refreshError: null }
  }

  if (partial) {
    return { ...base, status: 'partial', provenance, refreshError: null }
  }

  if (maxAgeMs != null && ageMs != null && ageMs > maxAgeMs) {
    return {
      ...base,
      status: 'stale',
      provenance: provenance === 'live' ? 'cached' : provenance,
      refreshError: null,
    }
  }

  return { ...base, status: 'ok', provenance, refreshError: null }
}

/** Ranking used when several sources feed one panel: worst state wins. */
const STATUS_SEVERITY: Record<DataStatus, number> = {
  ok: 0,
  unavailable: 1,
  partial: 2,
  stale: 3,
  initial: 4,
  initialFailure: 5,
}

/**
 * Merge several {@link DataState}s into the single state a panel should show.
 *
 * A panel fed by four sources where one failed its refresh is `partial`, not
 * `ok` and not `initialFailure` — the three healthy sources still render.
 * `initialFailure` is only reported when EVERY source failed its first load,
 * which is the only situation where the panel truly has nothing to say.
 */
export function combineDataStates(
  states: readonly DataState<unknown>[],
): Pick<
  DataState<unknown>,
  'status' | 'provenance' | 'isRefreshing' | 'isRefreshBlocked' | 'refreshError' | 'fatalError' | 'updatedAt' | 'ageMs'
> {
  if (states.length === 0) {
    return {
      status: 'initial',
      provenance: 'unknown',
      isRefreshing: false,
      isRefreshBlocked: false,
      refreshError: null,
      fatalError: null,
      updatedAt: null,
      ageMs: null,
    }
  }

  const anyData = states.some((s) => s.hasData)
  const allFailed = states.every((s) => s.status === 'initialFailure')
  const worst = states.reduce((acc, s) =>
    STATUS_SEVERITY[s.status] > STATUS_SEVERITY[acc.status] ? s : acc,
  )

  let status: DataStatus
  if (allFailed) {
    status = 'initialFailure'
  } else if (anyData && (worst.status === 'initialFailure' || worst.status === 'initial')) {
    // Mixed outcome: something is renderable, so the panel is partial —
    // it must not be replaced by an error or a skeleton.
    status = 'partial'
  } else {
    status = worst.status
  }

  const provenances = new Set(states.filter((s) => s.hasData).map((s) => s.provenance))
  const provenance: DataProvenance =
    provenances.size === 1 ? [...provenances][0]! : provenances.size === 0 ? 'unknown' : 'cached'

  // The panel is only as fresh as its OLDEST contributing source, so take
  // the minimum `updatedAt` / maximum `ageMs` rather than the newest.
  const updatedAts = states.map((s) => s.updatedAt).filter((v): v is number => v != null)
  const ages = states.map((s) => s.ageMs).filter((v): v is number => v != null)

  return {
    status,
    provenance,
    isRefreshing: states.some((s) => s.isRefreshing),
    isRefreshBlocked: states.some((s) => s.isRefreshBlocked),
    refreshError: states.find((s) => s.refreshError != null)?.refreshError ?? null,
    fatalError: allFailed ? (states.find((s) => s.fatalError != null)?.fatalError ?? null) : null,
    updatedAt: updatedAts.length > 0 ? Math.min(...updatedAts) : null,
    ageMs: ages.length > 0 ? Math.max(...ages) : null,
  }
}

/** `true` when a state still has something renderable on screen. */
export function hasRenderableData(state: DataState<unknown>): boolean {
  return state.hasData
}

/**
 * `true` when the state is the only situation in which a caller may replace
 * page content with an error surface.
 */
export function isFatal(state: DataState<unknown>): boolean {
  return state.status === 'initialFailure' && !state.hasData
}

// ───────────────────────────────────────────────────────────────────────────
// Unknown-honest value helpers
//
// `value ?? 0` is banned for operational readings. A missing odometer is not
// a zero odometer; a missing charge rate is not "not charging". These helpers
// keep the unknown case unknown all the way to the render boundary, where a
// formatter turns `null` into an em dash.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Narrow an operational reading to a finite number, or `null` when it is
 * genuinely unknown. Never substitutes `0`.
 *
 * Rejects `null`, `undefined`, `NaN`, `±Infinity`, empty/whitespace strings
 * and non-numeric strings. Numeric strings are accepted because several
 * backend numeric columns serialize as strings through the aggregate views.
 */
export function knownNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Narrow to a non-empty string, or `null` when unknown. Never returns `''`. */
export function knownString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** `true` when a value is a real reading rather than an unknown placeholder. */
export function isKnown<T>(value: T | null | undefined): value is T {
  return value != null
}

/**
 * Sum readings while preserving unknown-ness. Returns `null` when there is
 * nothing known to add, so an all-unknown series does not masquerade as `0`.
 * Known members are summed and unknown members are skipped, which is the
 * correct behaviour for a partial series.
 */
export function sumKnown(values: readonly unknown[]): number | null {
  let total = 0
  let seen = false
  for (const raw of values) {
    const n = knownNumber(raw)
    if (n == null) continue
    total += n
    seen = true
  }
  return seen ? total : null
}

/**
 * Mean of the known readings, or `null` when none are known. Unknown members
 * are excluded from BOTH numerator and denominator — averaging them in as `0`
 * would silently drag every fleet metric toward zero.
 */
export function averageKnown(values: readonly unknown[]): number | null {
  let total = 0
  let count = 0
  for (const raw of values) {
    const n = knownNumber(raw)
    if (n == null) continue
    total += n
    count += 1
  }
  return count === 0 ? null : total / count
}
