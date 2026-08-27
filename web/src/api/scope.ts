/**
 * @module api/scope
 *
 * Canonical propagation of the four dimensions every read in TeslaSync is
 * scoped by — **vehicle, date range, timezone, unit system** — plus the
 * machinery that guarantees a response for one scope can never be rendered
 * under another.
 *
 * ## Why a module instead of ad-hoc template literals
 *
 * Hooks used to build their own URLs, and the two recurring defects were:
 *
 *   - `?vehicleId=3` — camelCase params silently ignored by the Go handlers,
 *     which read snake_case (`chi` + `apiparams`), so the endpoint quietly
 *     returned the unfiltered fleet result;
 *   - `/api/v1/drives` passed to `request()`, which prepends `/api/v1` and
 *     produced `/api/v1/api/v1/drives`.
 *
 * {@link scopeSearchParams} rejects both by construction: keys are converted
 * to snake_case and {@link scopedPath} strips an accidental prefix.
 *
 * ## Superseded responses
 *
 * Putting the scope in the query key already stops TanStack Query from
 * writing vehicle A's rows into vehicle B's cache entry. But any hand-rolled
 * async work outside the query cache (imperative exports, geocode lookups,
 * search-as-you-type) still races. {@link createScopeSequencer} closes that
 * gap: starting a new run aborts the previous one and any late resolution
 * from a superseded run is rejected with {@link SupersededRequestError}
 * rather than being applied to fresher UI state.
 */

/** The scope dimensions every scoped read must agree on. */
export interface QueryScope {
  /** Selected vehicle. `null`/`undefined` means "fleet-wide". */
  vehicleId?: string | number | null
  /** Inclusive ISO-8601 window start. */
  start?: string | null
  /** Inclusive ISO-8601 window end. */
  end?: string | null
  /** IANA timezone the window was authored in (e.g. `America/Los_Angeles`). */
  timezone?: string | null
  /**
   * Display unit system in effect (`metric` / `imperial`). The API always
   * returns SI; this travels only so exports can be rendered in the unit
   * system the user is looking at.
   */
  units?: string | null
  /** Additional page-level filters. Keys are normalised to snake_case. */
  filters?: Readonly<Record<string, string | number | boolean | null | undefined>>
}

/** Convert a camelCase or PascalCase identifier to the backend's snake_case. */
export function toSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function isMeaningful(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  return true
}

/**
 * Stable, order-independent cache key for a scope.
 *
 * Filters are sorted so `{ a, b }` and `{ b, a }` produce the same key —
 * otherwise React state that rebuilds the filter object in a different order
 * would evict and refetch the identical query.
 *
 * Absent dimensions are emitted as `null` (not omitted) so a key never
 * collides with a shorter key that happens to share a prefix.
 */
export function scopeKey(scope: QueryScope = {}): readonly unknown[] {
  const filters = scope.filters ?? {}
  const normalisedFilters = Object.keys(filters)
    .filter((key) => isMeaningful(filters[key]))
    .sort()
    .map((key) => [toSnakeCase(key), String(filters[key])] as const)

  return [
    scope.vehicleId != null && String(scope.vehicleId).trim() !== '' ? String(scope.vehicleId) : null,
    isMeaningful(scope.start) ? scope.start : null,
    isMeaningful(scope.end) ? scope.end : null,
    isMeaningful(scope.timezone) ? scope.timezone : null,
    isMeaningful(scope.units) ? scope.units : null,
    normalisedFilters,
  ]
}

export interface ScopeSearchParamsOptions {
  /**
   * Include `timezone` / `units` in the emitted query string. Off by default:
   * most read endpoints are timezone- and unit-agnostic (they return SI in
   * UTC), and sending the params anyway would fragment the server cache. Turn
   * on for exports and for the bucketed analytics endpoints that group by
   * local calendar day.
   */
  includePresentation?: boolean
}

/**
 * Build the snake_case query string for a scope.
 *
 * Guarantees enforced here:
 *   - every key is snake_case, so a camelCase field name in the caller's
 *     filter object cannot reach the wire;
 *   - empty strings, `null`, `undefined` and `NaN` are omitted rather than
 *     serialised as `""` / `"null"` / `"NaN"`;
 *   - values are URL-encoded via `URLSearchParams`;
 *   - keys are sorted, so the same scope always yields byte-identical URLs
 *     and therefore hits the browser + server cache.
 */
export function scopeSearchParams(
  scope: QueryScope = {},
  options: ScopeSearchParamsOptions = {},
): string {
  const params = new URLSearchParams()
  const put = (key: string, value: unknown) => {
    if (!isMeaningful(value)) return
    params.set(toSnakeCase(key), String(value))
  }

  put('vehicle_id', scope.vehicleId)
  put('start', scope.start)
  put('end', scope.end)
  if (options.includePresentation === true) {
    put('timezone', scope.timezone)
    put('units', scope.units)
  }
  for (const [key, value] of Object.entries(scope.filters ?? {})) {
    put(key, value)
  }

  params.sort()
  return params.toString()
}

/**
 * Compose a scoped path for {@link import('./client').request}.
 *
 * The `/api/v1` prefix is stripped defensively: `request()` adds it, and a
 * caller that includes it produces `/api/v1/api/v1/...`. Any query string
 * already present on `basePath` is merged with the scope's params rather
 * than being clobbered.
 *
 * A `#fragment` is split off **before** the query is parsed and re-appended
 * last. Without that split, `/drives#top` parses as a path of `/drives#top`
 * (fragment fused into the last param value for `/drives?a=1#top`), so the
 * emitted URL either carries a bogus param value or silently drops the
 * anchor. Fragments are client-side only — they must survive untouched and
 * must never be sent as query data.
 */
export function scopedPath(
  basePath: string,
  scope: QueryScope = {},
  options: ScopeSearchParamsOptions = {},
): string {
  const withSlash = basePath.startsWith('/') ? basePath : `/${basePath}`
  const stripped = withSlash.replace(/^\/api\/v1(?=\/|$)/, '')
  const normalised = stripped === '' ? '/' : stripped

  // Fragment first: everything from the FIRST '#' onward is the fragment,
  // including any later '?' (which is a literal character inside a fragment,
  // not a query delimiter).
  const hashIndex = normalised.indexOf('#')
  const fragment = hashIndex >= 0 ? normalised.slice(hashIndex) : ''
  const beforeFragment = hashIndex >= 0 ? normalised.slice(0, hashIndex) : normalised

  // Split at the FIRST '?' by index. `split('?', 2)` looks equivalent but is
  // not: it discards everything after the second delimiter, so a legitimate
  // literal '?' inside a value (`/drives?search=a?b`) silently truncated the
  // query to `search=a`. Only the first '?' delimits; the rest of the string
  // is query data.
  const queryIndex = beforeFragment.indexOf('?')
  const rawPath = queryIndex >= 0 ? beforeFragment.slice(0, queryIndex) : beforeFragment
  const existingQuery = queryIndex >= 0 ? beforeFragment.slice(queryIndex + 1) : ''
  const pathOnly = rawPath === '' ? '/' : rawPath

  const merged = new URLSearchParams(existingQuery)
  for (const [key, value] of new URLSearchParams(scopeSearchParams(scope, options))) {
    merged.set(key, value)
  }
  merged.sort()
  const query = merged.toString()
  return query === '' ? `${pathOnly}${fragment}` : `${pathOnly}?${query}${fragment}`
}

/**
 * Thrown when an in-flight run is replaced by a newer one for a different
 * scope. Callers should swallow it: it is not a failure, it is the correct
 * outcome of the user moving on.
 */
export class SupersededRequestError extends Error {
  constructor(message = 'Request superseded by a newer scope') {
    super(message)
    this.name = 'SupersededRequestError'
  }
}

/** `true` for {@link SupersededRequestError} and for native aborts. */
export function isSupersededOrAborted(error: unknown): boolean {
  if (error instanceof SupersededRequestError) return true
  const name = (error as { name?: unknown } | null)?.name
  return typeof name === 'string' && (name === 'AbortError' || name === 'SupersededRequestError')
}

export interface ScopeSequencer {
  /**
   * Run `task` under the given scope.
   *
   * Only a **different** scope supersedes: switching scope aborts every run
   * still in flight for the previous scope and rejects them with
   * {@link SupersededRequestError}, even if their network call already
   * resolved.
   *
   * Concurrent runs of the SAME scope are peers — a plain "refresh" issued
   * while a first request is still in flight must not cancel itself, and both
   * results are valid for the scope the user is still looking at.
   */
  run<T>(scope: readonly unknown[], task: (signal: AbortSignal) => Promise<T>): Promise<T>
  /** Abort whatever is in flight (component unmount). */
  cancel(): void
  /** Cache key of the currently active scope, for assertions. */
  readonly currentKey: string | null
  /**
   * Number of `run()` wrappers that have not yet settled.
   *
   * Counts the WRAPPER, not the underlying task: a superseded run stays
   * counted until its own promise rejects (the next microtask), and a
   * non-cooperative task that never settles stops being counted as soon as
   * its wrapper rejects. The wrapper is the promise callers hold, so it is
   * the only lifetime they can act on.
   */
  readonly inFlightCount: number
}

/**
 * Create a sequencer that guarantees only the newest scope's result is ever
 * delivered.
 *
 * ```ts
 * const sequencer = useMemo(createScopeSequencer, [])
 * const rows = await sequencer.run(scopeKey(scope), (signal) =>
 *   request<Row[]>(scopedPath('/drives', scope), { signal }),
 * )
 * ```
 *
 * Supersession is tracked by a **per-scope generation counter** rather than a
 * per-call token. A per-call token makes every concurrent call its own
 * generation, so a second same-scope request would silently invalidate the
 * first — turning an ordinary double-fetch into a spurious
 * `SupersededRequestError` for a result that is still perfectly current.
 * The generation advances only when the scope actually changes (or on
 * `cancel()`), which is exactly when a pending result stops being valid.
 *
 * ## Non-cooperative tasks
 *
 * `AbortSignal` is advisory: a task may ignore it, and some never settle at
 * all (a hung socket with no timeout, a mocked fetch, a promise whose
 * resolver is dropped). Awaiting the task alone would leave the caller's
 * promise pending forever after the user has navigated away — the UI keeps a
 * spinner up for a scope nobody is looking at.
 *
 * Each run therefore races its task against a supersession promise that is
 * rejected synchronously on scope change / `cancel()`, so the caller's
 * promise settles promptly whether or not the task cooperates. A rejection
 * handler is attached to BOTH sides at creation, so a late underlying failure
 * arriving after the race is decided can never surface as an unhandled
 * rejection.
 */
export function createScopeSequencer(): ScopeSequencer {
  interface Entry {
    controller: AbortController
    /** Rejects this run's supersession promise. Idempotent. */
    supersede: () => void
  }

  const entries = new Set<Entry>()
  let generation = 0
  let activeKey: string | null = null

  const serialise = (scope: readonly unknown[]): string => {
    try {
      return JSON.stringify(scope)
    } catch {
      return scope.map((part) => String(part)).join('\u0000')
    }
  }

  /**
   * Abort + supersede every run still in flight. Bookkeeping is deliberately
   * NOT cleared here: an entry is removed only when its own wrapper settles,
   * so `inFlightCount` never claims a promise the caller still holds has
   * finished. Repeat calls against an already-superseded entry are no-ops
   * (a settled promise ignores further rejections).
   */
  const supersedeAllInFlight = (): void => {
    for (const entry of entries) {
      entry.controller.abort()
      entry.supersede()
    }
  }

  return {
    get currentKey() {
      return activeKey
    },
    get inFlightCount() {
      return entries.size
    },
    cancel() {
      generation += 1
      activeKey = null
      supersedeAllInFlight()
    },
    async run<T>(scope: readonly unknown[], task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const key = serialise(scope)
      if (activeKey !== null && activeKey !== key) {
        // Scope changed: every pending run belongs to a view the user has
        // left. Advance the generation BEFORE the cascade so any run that
        // resumes mid-abort already sees itself as superseded.
        generation += 1
        supersedeAllInFlight()
      }
      activeKey = key

      const myGeneration = generation
      const controller = new AbortController()

      let supersede: () => void = () => {}
      const supersededPromise = new Promise<never>((_resolve, reject) => {
        supersede = () => reject(new SupersededRequestError())
      })
      // Handled at creation: when the task wins the race this promise can
      // still be rejected later with nobody awaiting it.
      supersededPromise.catch(() => {})

      const entry: Entry = { controller, supersede }
      entries.add(entry)

      // Normalising through an async IIFE turns a task that throws
      // synchronously into a rejected promise, so the race below cannot throw
      // past the bookkeeping.
      const taskPromise = (async () => task(controller.signal))()
      // Handled at creation: a task that rejects AFTER being superseded would
      // otherwise be an unhandled rejection.
      taskPromise.catch(() => {})

      try {
        const result = await Promise.race([taskPromise, supersededPromise])
        // The await above yields; by the time we resume the scope may have
        // changed. Comparing generations — not per-call tokens — is what lets
        // same-scope peers both succeed while a scope change supersedes.
        if (myGeneration !== generation) throw new SupersededRequestError()
        return result
      } catch (error) {
        if (myGeneration !== generation) throw new SupersededRequestError()
        throw error
      } finally {
        // Bookkeeping is released when the WRAPPER settles — never earlier —
        // so inFlightCount tracks the promise the caller is actually holding.
        entries.delete(entry)
      }
    },
  }
}
