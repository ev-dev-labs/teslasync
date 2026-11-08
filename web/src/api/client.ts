/** Resilient transport; browser authentication belongs to the external provider. */
import { resilientFetch, ApiError, getApiBase, isApiError, camelCaseKeys, parseError, notifyAuthenticationRequired, TeslaAuthExpiredError } from '../lib/resilience'
import { authHeaders, isRemoteMode } from '../lib/serverConnection'
import { assertOperationalWriteAllowed } from '../lib/operationalMode'
import { assertNeverQueuedOffline } from './offlineCache'
import { assertDocumentActive } from '../lib/documentCancellation'
import {
  demoCredentialsMode,
  getDemoApiBase,
  stripCredentialHeadersForDemo,
} from '../lib/demoMode'

import { confirmAction, requiresActionConfirmation, ActionCanceledError } from './actionConfirmation'
export { ActionCanceledError, registerActionConfirmationProvider, __resetActionConfirmationForTests } from './actionConfirmation'
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
 * Sentinel code returned by every endpoint that has no sensible
 * behaviour without an upstream identity provider configured. Mirrors the backend
 * constants `internal/api.ErrCodeAuthModeOpen` and
 * `internal/auth.AuthModeOpenCode`.
 *
 * Auth-coupled hooks (useAuthMode and useImpersonation) match this code on a 501
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

async function directRequest<T>(
  path: string,
  options: RequestInit,
  responseType: 'json' | 'text',
  acceptedStatuses: readonly number[],
): Promise<T> {
  assertDocumentActive()
  const { headers, body, ...rest } = options
  const credentials = demoCredentialsMode()
  const res = await fetch(apiUrl(path), {
    ...rest,
    body,
    headers: buildHeaders(headers, body != null),
    // Only set when a cross-origin demo base is active; `undefined` leaves
    // fetch's `same-origin` default untouched for every normal request.
    ...(isRemoteMode() ? { credentials: 'omit' as const } : credentials ? { credentials } : {}),
  })

  if (!res.ok && !acceptedStatuses.includes(res.status)) {
    const { message, code } = await parseError(res)
    throw new ApiError(message, res.status, code)
  }

  if (responseType === 'json' && res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
    throw new ApiError('External authentication required', 401)
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

/** Confirmation happens before transport, never in response to a credential error. */
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

  const originalBase = getApiBase()
  const originalIdentity = authHeaders(headers).get('Authorization')
  const needsConfirmation = requiresActionConfirmation(fetchOptions.method, normalisedPath)
  if (needsConfirmation) {
    await confirmAction(normalisedPath, fetchOptions.signal)
    assertDocumentActive()
    fetchOptions.signal?.throwIfAborted()
    assertOperationalWriteAllowed(fetchOptions.method, requiresLiveMode)
    assertNeverQueuedOffline(fetchOptions.method, normalisedPath)
    if (getApiBase() !== originalBase || authHeaders(headers).get('Authorization') !== originalIdentity) {
      throw new ActionCanceledError('The app connection changed before confirmation')
    }
  }
  const requestHeaders = authHeaders(headers)

  try {
    return await directRequest<T>(
      normalisedPath,
      { ...fetchOptions, headers: requestHeaders },
      responseType,
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

    if (isApiError(err) && err.status === 401) {
      notifyAuthenticationRequired(err.code)
      if (err.code === 'TESLA_TOKEN_EXPIRED') throw new TeslaAuthExpiredError(err.message)
      throw err
    }

    // For text responses or callers that opted out of the resilient
    // refresh loop, the directRequest result IS the final answer —
    // re-throw rather than re-attempting through resilientFetch
    // (which doesn't know about the text response type).
    if (responseType === 'text' || skipAuthRefresh || needsConfirmation ||
      !['GET', 'HEAD', 'OPTIONS'].includes((fetchOptions.method ?? 'GET').toUpperCase())) {
      throw err
    }

    // Missing/unavailable features are final responses, not transport failures.
    // Reissuing them serially adds a round trip before shell hooks can settle.
    if (isApiError(err) && (err.status === 404 || err.status === 501)) {
      throw err
    }

    // Fall through: rerun via resilientFetch so the original retry,
    // circuit-breaker policies still apply for
    // transient read failures.
    return resilientFetch<T>(normalisedPath, {
      ...fetchOptions,
      headers: requestHeaders,
      acceptedStatuses,
    })
  }
}
