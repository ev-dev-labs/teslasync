/**
 * @module api/offlineCache
 *
 * Rules for what the SPA is allowed to serve — and to attempt — while the
 * device has no network.
 *
 * Two separate concerns, deliberately in one place so they cannot drift:
 *
 * ## 1. What may be served from cache offline
 *
 * Only **safe reads** (`GET` / `HEAD` / `OPTIONS`). A cached read is served
 * with a snapshot timestamp so the viewer can see *when* the value was true
 * rather than mistaking a 40-minute-old state of charge for the current one.
 * See {@link describeOfflineSnapshot}.
 *
 * ## 2. What must never be queued
 *
 * Vehicle commands, data-repair writes and security/identity writes are
 * **rejected immediately** when offline. They are never buffered for replay,
 * because replay-on-reconnect is actively dangerous for this domain:
 *
 *   - a queued `door/unlock` or `climate/start` fires minutes later, in a
 *     different place, with a different person near the car;
 *   - a queued data-repair `close`/`quarantine` applies an operator decision
 *     that was made against a snapshot the operator can no longer see, and
 *     may collide with a repair another operator already applied;
 *   - a queued session revoke / API-key rotation silently re-locks an account
 *     the user has since deliberately re-enabled.
 *
 * The mutation defaults in `api/queryClient.ts` (`retry: 0`,
 * `networkMode: 'always'`) already guarantee a mutation fails fast instead of
 * pausing. {@link assertNeverQueuedOffline} is the defence-in-depth layer at
 * the request boundary: it turns "would have failed with a confusing network
 * error" into an explicit, typed, user-readable refusal.
 */

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Paths whose writes must never be attempted — let alone queued — without a
 * live connection. Matched against the prefix-free path handed to
 * `request()` (i.e. without `/api/v1`).
 *
 * Kept as explicit patterns rather than a "block every write" rule because
 * plenty of writes ARE safe to fail-and-retry by hand (saving a dashboard
 * layout, marking a notification read). The danger is specific to commands
 * that touch the physical vehicle, records that encode an operator judgement,
 * and credentials.
 */
export const OFFLINE_UNSAFE_PATTERNS: readonly RegExp[] = [
  // Physical vehicle actuation and wake/refresh commands.
  /^\/vehicles\/[^/]+\/(command|wake|refresh)/i,
  /^\/commands?(\/|$)/i,
  /^\/watch\/[^/]+\/command/i,
  /^\/guard\/(panic|config)/i,
  // Operator judgement encoded into the data set.
  /^\/data-repair(\/|$)/i,
  /^\/repair-cases?(\/|$)/i,
  /^\/quarantine(\/|$)/i,
  /^\/dlq\/[^/]*replay/i,
  // Credentials, sessions and access control.
  /^\/auth(\/|$)/i,
  /^\/sessions?(\/|$)/i,
  /^\/totp(\/|$)/i,
  /^\/admin\/api-keys?(\/|$)/i,
  /^\/impersonation(\/|$)/i,
  /^\/rbac(\/|$)/i,
  /^\/vehicles\/[^/]+\/(drivers|invitations)/i,
]

/** `true` for methods that cannot change server state. */
export function isSafeMethod(method: string | undefined): boolean {
  return SAFE_METHODS.has((method ?? 'GET').toUpperCase())
}

function normalisePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  const withoutPrefix = withSlash.replace(/^\/api\/v1(?=\/|$)/, '')
  const [pathOnly] = withoutPrefix.split('?', 1)
  return pathOnly === '' ? '/' : pathOnly!
}

/**
 * `true` when the request may be answered from the offline cache: a safe
 * method on any path. Unsafe methods are never cacheable, so a POST result
 * can never be replayed to the user as if it were current state.
 */
export function isOfflineSafeRead(method: string | undefined, _path: string): boolean {
  return isSafeMethod(method)
}

/**
 * `true` when this request is one of the destructive classes that must fail
 * immediately rather than wait for connectivity.
 */
export function isOfflineUnsafeWrite(method: string | undefined, path: string): boolean {
  if (isSafeMethod(method)) return false
  const normalised = normalisePath(path)
  return OFFLINE_UNSAFE_PATTERNS.some((pattern) => pattern.test(normalised))
}

export const OFFLINE_WRITE_REJECTED_CODE = 'OFFLINE_WRITE_REJECTED' as const

/**
 * Thrown instead of attempting — or queueing — a destructive write while the
 * device is offline. Carries a `code` so hooks can render a specific message
 * rather than a generic network failure.
 */
export class OfflineWriteRejectedError extends Error {
  readonly code = OFFLINE_WRITE_REJECTED_CODE
  readonly path: string

  constructor(path: string) {
    super(
      'This action needs a live connection and is never queued for later. '
      + 'Reconnect and run it again so it applies in the context you can see.',
    )
    this.name = 'OfflineWriteRejectedError'
    this.path = path
  }
}

export function isOfflineWriteRejectedError(error: unknown): error is OfflineWriteRejectedError {
  return (
    error instanceof OfflineWriteRejectedError
    || (typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === OFFLINE_WRITE_REJECTED_CODE)
  )
}

/**
 * Reject destructive commands, repairs and security writes while offline.
 *
 * Called from `request()` before any network attempt. `online` is injectable
 * so the rule is testable without mutating `navigator`.
 */
export function assertNeverQueuedOffline(
  method: string | undefined,
  path: string,
  online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
): void {
  if (online) return
  if (!isOfflineUnsafeWrite(method, path)) return
  throw new OfflineWriteRejectedError(normalisePath(path))
}

export interface OfflineSnapshot {
  /** ISO timestamp the cached payload was captured, or `null` if unknown. */
  asOf: string | null
  ageMs: number | null
  /**
   * `true` when the value on screen predates the current connection state and
   * must be labelled as a snapshot rather than as current.
   */
  isSnapshot: boolean
}

/**
 * Describe a cached payload so the UI can label it honestly while offline.
 *
 * An unknown `updatedAt` yields `asOf: null` — the caller renders "as of
 * unknown time", never "as of now". Silently substituting the current time
 * here would be the exact class of lie this module exists to prevent.
 */
export function describeOfflineSnapshot(
  updatedAt: number | null | undefined,
  online: boolean,
  now: number = Date.now(),
): OfflineSnapshot {
  if (updatedAt == null || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return { asOf: null, ageMs: null, isSnapshot: !online }
  }
  return {
    asOf: new Date(updatedAt).toISOString(),
    ageMs: Math.max(0, now - updatedAt),
    isSnapshot: !online,
  }
}
