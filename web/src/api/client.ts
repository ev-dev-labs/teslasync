/**
 * @module api/client
 *
 * Foundation layer — resilient HTTP helper used by every domain module.
 *
 * Step-up reauth interceptor for sensitive admin endpoints.
 * Sensitive admin endpoints (revoke API key, delete vehicle, drop a
 * data-repair table, restore a backup, rotate the Tesla token) require
 * a fresh credential before they fire. The backend gates them with
 * RequireSudo middleware that returns 401 + `code: 'SUDO_REQUIRED'`
 * when no valid X-Sudo-Token is present.
 *
 * This module:
 *   • caches the minted token in memory (NEVER localStorage) and
 *     attaches it as `X-Sudo-Token` on every outbound request;
 *   • on a 401+SUDO_REQUIRED response, calls a registered challenge
 *     provider (the <ReauthDialog> via {@link registerSudoChallengeProvider})
 *     to mint a fresh token, then replays the original request once;
 *   • on user cancel, throws {@link SudoCanceledError} so callers can
 *     distinguish "user gave up" from a true API failure.
 *
 * The interceptor sits OUTSIDE resilientFetch on purpose: the
 * auto-refresh-on-401 path inside resilientFetch would otherwise
 * dispatch SessionExpiredModal before we ever see the SUDO_REQUIRED
 * code. For every request we therefore attempt a single directRequest
 * first; only on non-sudo failures do we fall through to the resilient
 * pipeline.
 */
import { resilientFetch, ApiError, getApiBase, isApiError, camelCaseKeys } from '../lib/resilience'
import { assertOperationalWriteAllowed } from '../lib/operationalMode'
import { assertNeverQueuedOffline } from './offlineCache'
import {
  demoCredentialsMode,
  getDemoApiBase,
  stripCredentialHeadersForDemo,
} from '../lib/demoMode'

export { ApiError, getApiBase, isApiError }

export interface ApiRequestOptions extends RequestInit {
  responseType?: 'json' | 'text'
  skipAuthRefresh?: boolean
  /**
   * Non-2xx response codes whose JSON body is still a successful domain
   * response. Use only for endpoints such as `/system/health`, where a
   * generated degraded snapshot intentionally carries HTTP 503.
   */
  acceptedStatuses?: readonly number[]
  /**
   * Marks a mutation as unsafe outside live mode. The client rejects it
   * before any network attempt while viewing `?as_of=` data or while offline,
   * preventing delayed vehicle/configuration changes from replaying later.
   */
  requiresLiveMode?: boolean
  /**
   * Optional. If provided, the fetch + retry loop honors cancellation:
   * the underlying fetch is wired to an abort signal that is the merge of
   * this signal and the internal timeout signal. When this signal is the
   * one that aborts (i.e. the caller cancels), the rejected promise
   * carries `name === 'AbortError'`, the retry loop exits immediately,
   * and the error is NOT classified as an HTTP timeout (408).
   *
   * Pass TanStack Query's `queryFn` `{ signal }` here so route changes
   * cancel in-flight requests instead of decoding into unmounted state.
   *
   * Allows `null` to match the underlying `RequestInit.signal` shape so
   * existing `{ ...options }` spreads keep type-checking.
   */
  signal?: AbortSignal | null
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`
  // Defensive strip: hooks must pass paths without the /api/v1 prefix.
  // This keeps a stray `/api/v1/foo` from becoming `/api/v1/api/v1/foo`.
  // Idempotent for the canonical `/foo` form.
  return withSlash.replace(/^\/api\/v1\//, '/')
}

/**
 * Builds a fully qualified API URL for browser-owned flows such as downloads.
 *
 * HELP-12: when demo mode is fully and validly configured, the validated
 * isolated demo base is authoritative and the production base is never
 * consulted. `getDemoApiBase()` returns null for every partially-configured
 * state, so a malformed demo build falls back to normal behaviour rather than
 * producing half-demo traffic.
 */
export function apiUrl(path: string): string {
  const demoBase = getDemoApiBase()
  if (demoBase !== null) return `${demoBase}${normalizePath(path)}`
  return `${getApiBase()}/api/v1${normalizePath(path)}`
}

function buildHeaders(headers: HeadersInit | undefined, hasBody: boolean): Headers {
  const merged = new Headers(headers)
  if (!merged.has('Accept')) merged.set('Accept', 'application/json')
  if (hasBody && !merged.has('Content-Type')) merged.set('Content-Type', 'application/json')
  // HELP-12: never ship caller identity to a cross-origin demo fixture host.
  // No-op in normal mode and for a same-origin demo base.
  return stripCredentialHeadersForDemo(merged)
}

/**
 * Sentinel code returned by the backend when a request hits a route
 * gated by the RequireSudo middleware and the caller has not provided
 * a valid `X-Sudo-Token`. Kept as a const so callers can check
 * `e.code === SUDO_REQUIRED_CODE` instead of magic-stringing it.
 */
export const SUDO_REQUIRED_CODE = 'SUDO_REQUIRED'

/**
 * Sentinel code returned by every endpoint that has no sensible
 * behaviour without an upstream identity provider configured. Mirrors the backend
 * constants `internal/api.ErrCodeAuthModeOpen` and
 * `internal/auth.AuthModeOpenCode`.
 *
 * Auth-coupled hooks (useAuthMode, useTOTP, useSessions,
 * useImpersonation, useRbacMatrix, …) match this code on a 501
 * response to swap in the inline "feature requires authentication"
 * placeholder via <RequiresAuth>. Callers that need a richer typed
 * error can build it from `isApiError(err) && err.code ===
 * AUTH_MODE_OPEN_CODE`; we deliberately do NOT subclass ApiError
 * here because the existing duck-type check already terminates
 * resilientFetch's retry loop (501 is non-retryable) and a
 * subclass would mean threading a new instanceof ladder through
 * every consumer.
 */
export const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN'

/**
 * Signals that the user dismissed the <ReauthDialog> instead of
 * supplying a credential. Distinct from ApiError so callers can tell
 * "user cancelled" apart from "backend rejected the credential".
 */
export class SudoCanceledError extends Error {
  constructor(message = 'Reauthentication cancelled by user') {
    super(message)
    this.name = 'SudoCanceledError'
  }
}

/**
 * Token returned by the challenge provider after a successful
 * /auth/reauth call. `mode === 'open'` indicates the install runs
 * without a forward-auth header — no token is issued and the dialog
 * resolved via typed-confirmation only; in that mode subsequent
 * requests should NOT carry an X-Sudo-Token header.
 */
export interface SudoCredential {
  mode: 'open' | 'session'
  token?: string
  /** RFC3339 timestamp when the token expires. */
  expiresAt?: string
}

/**
 * Function signature the <ReauthDialog> registers via
 * {@link registerSudoChallengeProvider}. Called by the interceptor on
 * a 401+SUDO_REQUIRED. Resolves with a SudoCredential or rejects with
 * a {@link SudoCanceledError}.
 *
 * The `path` argument is the API path that triggered the challenge,
 * passed in case the dialog wants to surface "you are about to do X"
 * context. The dialog implementation MAY ignore it.
 */
export type SudoChallengeProvider = (path: string) => Promise<SudoCredential>

let sudoProvider: SudoChallengeProvider | null = null

/**
 * Registers the dialog opener used by the SUDO_REQUIRED interceptor.
 * <ReauthDialogRoot> calls this on mount so callers don't need to
 * manually wire it. Returns an unregister function for tests.
 */
export function registerSudoChallengeProvider(
  provider: SudoChallengeProvider,
): () => void {
  sudoProvider = provider
  return () => {
    if (sudoProvider === provider) sudoProvider = null
  }
}

interface CachedSudoToken {
  token: string
  expiresAtMs: number
}

let cachedSudoToken: CachedSudoToken | null = null

/**
 * Returns the cached token if non-null and not yet expired, else null.
 * Centralised here so both the request injector and the interceptor
 * use the same expiry check.
 */
function getCachedSudoToken(): CachedSudoToken | null {
  if (cachedSudoToken == null) return null
  if (cachedSudoToken.expiresAtMs <= Date.now()) {
    cachedSudoToken = null
    return null
  }
  return cachedSudoToken
}

/**
 * Stashes a freshly minted token. Pass `null` to clear (e.g. on
 * /auth/disconnect). Never persists to storage — process-restart and
 * tab-close discard the token, matching the security posture.
 */
export function setCachedSudoToken(value: CachedSudoToken | null): void {
  cachedSudoToken = value
}

/**
 * Test-only escape hatch — wipes the in-memory cache and the
 * registered provider so a fresh `describe` block starts from a known
 * baseline. Marked with the `__tests__` underscore prefix to flag for
 * lint that it should not be imported from production code.
 */
export function __resetSudoStateForTests(): void {
  cachedSudoToken = null
  sudoProvider = null
}

/**
 * Parses an error response body. Returns the human message AND the
 * structured `code` (when present) so the SUDO_REQUIRED interceptor
 * can dispatch on the latter without parsing the body twice.
 */
async function parseError(res: Response): Promise<{ message: string; code?: string }> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('json')) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>)
    const message =
      typeof body.error === 'string' && body.error.trim() !== ''
        ? body.error
        : res.statusText
    const code = typeof body.code === 'string' && body.code.trim() !== '' ? body.code : undefined
    return { message, code }
  }
  const text = await res.text()
  return { message: text || res.statusText }
}

/**
 * Internal direct-fetch path used by both the interceptor and the
 * `skipAuthRefresh` opt-in. Exposed only to this module — external
 * callers should always go through {@link request} so they pick up
 * the sudo interceptor + header injection.
 */
async function directRequest<T>(
  path: string,
  options: RequestInit,
  responseType: 'json' | 'text',
  acceptedStatuses: readonly number[],
): Promise<T> {
  const { headers, body, ...rest } = options
  const credentials = demoCredentialsMode()
  const res = await fetch(apiUrl(path), {
    ...rest,
    body,
    headers: buildHeaders(headers, body != null),
    // Only set when a cross-origin demo base is active; `undefined` leaves
    // fetch's `same-origin` default untouched for every normal request.
    ...(credentials ? { credentials } : {}),
  })

  if (!res.ok && !acceptedStatuses.includes(res.status)) {
    const { message, code } = await parseError(res)
    throw new ApiError(message, res.status, code)
  }

  if (responseType === 'text') {
    return await res.text() as T
  }

  if (res.status === 204) {
    return undefined as T
  }

  // Mirror resilientFetch: backend returns snake_case JSON; TS types expect
  // camelCase. camelCaseKeys() exposes BOTH forms so consumers can read either,
  // matching the contract every hook & page is built against. Without this,
  // every successful directRequest returns raw snake_case and camelCase reads
  // resolve to undefined (rendered as 0/—).
  return camelCaseKeys(await res.json()) as T
}

/**
 * Builds a fresh Headers from the user-supplied options and overlays
 * the cached sudo token (if any). Always returns a new Headers
 * instance so we never mutate the caller's object across retries.
 */
function withSudoToken(headers: HeadersInit | undefined, token: string | null): Headers {
  const merged = new Headers(headers)
  if (token != null) merged.set('X-Sudo-Token', token)
  return merged
}

/**
 * Treats an error as a SUDO_REQUIRED response from the backend. The
 * type guard lets the interceptor narrow before opening the dialog.
 */
function isSudoRequired(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 401 && err.code === SUDO_REQUIRED_CODE
}

/**
 * True when a thrown value is a cancellation — a DOMException or plain
 * Error whose `name` is 'AbortError'. DOMException does not extend Error
 * in every runtime (notably some jsdom builds), so we read `name` off the
 * raw value rather than relying on `instanceof Error`. Mirrors the abort
 * detection in resilience.ts.
 */
function isAbortError(err: unknown): boolean {
  if (err instanceof Error) return err.name === 'AbortError'
  return (
    typeof (err as { name?: unknown } | null)?.name === 'string' &&
    (err as { name: string }).name === 'AbortError'
  )
}

/**
 * Resolves a credential challenge through the registered provider.
 * Throws {@link SudoCanceledError} if no provider is registered (the
 * dialog never mounted) so callers fail closed instead of looping on
 * the same 401.
 */
async function challengeForSudo(path: string): Promise<SudoCredential> {
  if (sudoProvider == null) {
    throw new SudoCanceledError('No reauth dialog is mounted')
  }
  return sudoProvider(path)
}

/**
 * Computes the cache expiry for a freshly-minted token. When the
 * server omits `expires_at`, we fall back to a 5-minute window
 * matching the backend default (database.DefaultSudoTokenTTL).
 */
function expiresAtMsFromCredential(cred: SudoCredential): number {
  if (cred.expiresAt != null) {
    const parsed = Date.parse(cred.expiresAt)
    if (!Number.isNaN(parsed) && parsed > Date.now()) return parsed
  }
  return Date.now() + 5 * 60 * 1000
}

/**
 * Makes a resilient API request to the given path, with automatic retry
 * and circuit breaker protection.
 *
 * SUDO interception: every call attempts a single directRequest first
 * with the cached sudo token attached. If that returns 401+SUDO_REQUIRED,
 * the dialog is opened, the token is stored, and the request is
 * replayed once. Any other error falls through to the original
 * resilientFetch pipeline (which keeps its retry, circuit-breaker and
 * 401-refresh semantics intact).
 *
 * @template T - Expected JSON response type
 * @param path - API endpoint path (without /api/v1 prefix)
 * @param options - Standard fetch RequestInit options
 * @returns Parsed JSON response of type T
 */
export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const {
    responseType = 'json',
    skipAuthRefresh = false,
    acceptedStatuses = [],
    requiresLiveMode = false,
    headers,
    ...fetchOptions
  } = options

  assertOperationalWriteAllowed(fetchOptions.method, requiresLiveMode)

  // Normalise once at the entry point: ensures a leading slash AND
  // defensively strips any stray `/api/v1` prefix the caller passed.
  // Forward this canonical form to BOTH downstream paths so neither
  // directRequest (via apiUrl) nor the resilientFetch fallback (which
  // also concatenates `/api/v1` directly) can double-prefix.
  const normalisedPath = normalizePath(path)

  // Defence in depth for the offline contract: vehicle commands, data-repair
  // writes and security writes must fail loudly right here rather than be
  // attempted (and, under any future retry/persistence layer, queued) while
  // the device has no network. `requiresLiveMode` already covers the hooks
  // that opted in; this covers the class of path regardless of the flag.
  assertNeverQueuedOffline(fetchOptions.method, normalisedPath)

  const directResponseType: 'json' | 'text' = responseType
  const cached = getCachedSudoToken()
  const headersWithToken = withSudoToken(headers, cached?.token ?? null)

  // Attempt 1: directRequest. The interceptor needs to see the raw
  // 401+SUDO_REQUIRED before resilientFetch's auto-refresh path runs
  // (which would dispatch SessionExpiredModal on the second 401 and
  // confuse the user). For non-sudo failures we forward to the
  // resilient pipeline below.
  try {
    return await directRequest<T>(
      normalisedPath,
      { ...fetchOptions, headers: headersWithToken },
      directResponseType,
      acceptedStatuses,
    )
  } catch (err) {
    // Caller-initiated cancellation (route change / unmount via the
    // `signal` option) must short-circuit the entire pipeline: never open
    // the reauth dialog and never re-enter resilientFetch's retry loop.
    // Propagate the original AbortError unchanged so downstream consumers
    // can distinguish it from an HTTP 408 timeout — matching the
    // cancellation contract documented on ApiRequestOptions.signal.
    if (isAbortError(err)) throw err

    if (isSudoRequired(err)) {
      let cred: SudoCredential
      try {
        cred = await challengeForSudo(normalisedPath)
      } catch (challengeErr) {
        if (challengeErr instanceof SudoCanceledError) throw challengeErr
        throw new SudoCanceledError(
          challengeErr instanceof Error ? challengeErr.message : 'Reauth dialog failed',
        )
      }

      // Open mode: server confirms there is no credential to verify
      // (FORWARD_AUTH_HEADER unset). The typed-confirmation dialog
      // already resolved, so we replay the request unchanged. Token
      // header is intentionally NOT set — the route's RequireSudo
      // middleware is a passthrough in this mode.
      if (cred.mode === 'open') {
        return await directRequest<T>(
          normalisedPath,
          { ...fetchOptions, headers: withSudoToken(headers, null) },
          directResponseType,
          acceptedStatuses,
        )
      }

      if (cred.token == null || cred.token.trim() === '') {
        throw new SudoCanceledError('Reauth provider returned no token')
      }

      setCachedSudoToken({
        token: cred.token,
        expiresAtMs: expiresAtMsFromCredential(cred),
      })

      return await directRequest<T>(
        normalisedPath,
        { ...fetchOptions, headers: withSudoToken(headers, cred.token) },
        directResponseType,
        acceptedStatuses,
      )
    }

    // For text responses or callers that opted out of the resilient
    // refresh loop, the directRequest result IS the final answer —
    // re-throw rather than re-attempting through resilientFetch
    // (which doesn't know about the text response type).
    if (responseType === 'text' || skipAuthRefresh) {
      throw err
    }

    // Fall through: rerun via resilientFetch so the original retry,
    // circuit-breaker, and 401-refresh policies still apply for
    // transient or non-sudo failures.
    return resilientFetch<T>(normalisedPath, {
      ...fetchOptions,
      headers: headersWithToken,
      acceptedStatuses,
    })
  }
}
