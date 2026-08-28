/**
 * @module resilience
 *
 * Frontend resilience utilities for TeslaSync API communication.
 * Implements exponential-backoff retry with jitter, automatic GET
 * request deduplication, and browser offline detection.
 * All API calls should go through {@link resilientFetch}.
 */

import { broadcast } from './broadcast'
import { purgeServiceWorkerApiCache } from '@/sw/purgeApiCache'
// HELP-12. `demoMode` imports nothing from this module, so there is no cycle;
// it is a leaf that reads `import.meta.env` and validates it.
import { demoCredentialsMode, getDemoApiBase } from './demoMode'

type RequestStatus = 'online' | 'offline'

// --- Snake-case to camelCase transformer ---
// The Go backend returns snake_case JSON but TypeScript types use camelCase.

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

export function camelCaseKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelCaseKeys)
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const transformed = camelCaseKeys(value)
      result[key] = transformed
      const camelKey = snakeToCamel(key)
      if (camelKey !== key) {
        result[camelKey] = transformed
      }
    }
    return result
  }
  return obj
}

// --- API Base URL ---
// Injected at runtime by Nginx via sub_filter into index.html.
// A meta value avoids introducing a deployment-specific inline script, which
// keeps the production CSP free of script-src 'unsafe-inline'. The legacy
// window value remains a fallback for existing non-Nginx deployments.
declare global {
  interface Window {
    __TESLASYNC_API_BASE__?: string
  }
}

export function getApiBase(): string {
  const metaValue = typeof document === 'undefined'
    ? ''
    : document.querySelector('meta[name="teslasync-api-base"]')?.getAttribute('content') ?? ''
  return (metaValue || window.__TESLASYNC_API_BASE__ || '').trim().replace(/\/+$/, '')
}

// --- Offline Detection ---

let _status: RequestStatus = navigator.onLine ? 'online' : 'offline'
const _listeners = new Set<(s: RequestStatus) => void>()

function setStatus(s: RequestStatus) {
  if (_status === s) return
  _status = s
  _listeners.forEach(fn => fn(s))
}

window.addEventListener('online', () => setStatus('online'))
window.addEventListener('offline', () => setStatus('offline'))

/** Returns the current network connection status ('online' | 'offline'). */
export function getConnectionStatus(): RequestStatus { return _status }

/** Registers a callback invoked whenever the connection status changes. Returns an unsubscribe function. */
export function onStatusChange(fn: (s: RequestStatus) => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

// --- Request Deduplication ---

const inflight = new Map<string, Promise<unknown>>()

function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// --- Auth Middleware Session Expiry Detection ---
//
// When the upstream ForwardAuth proxy (Authentik / Authelia / oauth2-
// proxy / Cloudflare Access) reports the session has expired, we
// navigate the top-level window to the IdP's documented sign-in entry
// point — explicit handoff, never `window.location.reload()`.
//
// Why explicit nav, not reload:
//   * In an installed PWA there is no address bar; the user can't see a
//     reload "do" anything.
//   * Behind a Service Worker that may match the navigation request from
//     cache (the historical reason this code path looped on `/`), reload
//     can be swallowed entirely.
//   * Authentik's outpost expects an `rd=` (return-destination) query
//     parameter so it can deep-link the user back to the page they were
//     on after they sign in — reload loses that context.
//
// Default targets Authentik's proxy outpost at /outpost.goauthentik.io/start
// (verified against authentik upstream source — internal/outpost/proxyv2).
// Override per-deployment via window.__TESLASYNC_REAUTH_URL__ which the
// helm chart's nginx configmap can inject for non-Authentik IdPs.

const DEFAULT_REAUTH_URL = '/outpost.goauthentik.io/start'
const RETURN_URL_KEY = 'teslasync-return-url'

declare global {
  interface Window {
    __TESLASYNC_REAUTH_URL__?: string
  }
}

/**
 * Resolves the IdP reauth entry-point URL.
 *
 * Returns the runtime override when nginx injected one, otherwise the
 * Authentik outpost default. An explicit empty-string override disables
 * the IdP handoff entirely and the SPA falls back to `window.location
 * .reload()` — only safe in dev or in installs where the SW is configured
 * to NOT swallow navigations to `/`.
 */
export function getReauthUrl(): string | null {
  const override = window.__TESLASYNC_REAUTH_URL__
  if (typeof override === 'string') {
    const trimmed = override.trim()
    return trimmed === '' ? null : trimmed
  }
  return DEFAULT_REAUTH_URL
}

/**
 * Navigates the top-level window to the configured IdP reauth entry
 * point, preserving the current URL as the `rd=` query parameter so
 * the user lands back on the same page after sign-in. Falls back to
 * `window.location.reload()` when the reauth URL is explicitly
 * disabled (empty string override).
 *
 * Also writes the current href to sessionStorage as a defence-in-
 * depth fallback for proxies that strip `rd=` in the redirect chain;
 * App.tsx consumes that key on first mount post-auth.
 */
export function navigateToReauth(): void {
  // Identity transition: the cached authenticated API reads on disk belong to
  // the session we are leaving. Purge them BEFORE navigating so a different
  // user (or the same user after a permission change) can never be served the
  // previous identity's vehicle list, drives, or notification counts from
  // Cache Storage. The worker-side purge is dispatched synchronously and the
  // worker outlives this document, so it completes even though we navigate on
  // the next line. See `sw/purgeApiCache.ts`.
  purgeServiceWorkerApiCache()
  // Tell sibling tabs to do the same. Cache Storage is shared per-origin, so
  // the purge above already covers them, but a peer tab must also drop its
  // in-memory query cache and re-run its own purge in case this tab was
  // uncontrolled. `auth.logout` is the established topic for that.
  try {
    broadcast({ type: 'auth.logout' })
  } catch {
    // The bus is best-effort; never let it block a sign-out.
  }

  try {
    sessionStorage.setItem(RETURN_URL_KEY, window.location.href)
  } catch {
    // private-mode / quota — best-effort only
  }

  const base = getReauthUrl()
  if (!base) {
    window.location.reload()
    return
  }
  const returnUrl = encodeURIComponent(window.location.href)
  const sep = base.includes('?') ? '&' : '?'
  window.location.assign(`${base}${sep}rd=${returnUrl}`)
}

// Latch prevents N parallel in-flight queries each independently
// triggering a fresh navigation in the same JS tick. The latch is
// cleared by:
//   * a 30s timeout — escape hatch for the rare case where the
//     `window.location.assign` call did not actually navigate (browser
//     extension blocked it, manual intervention in devtools).
//   * the `focus` event — when the user returns to the tab, give them
//     an immediate retry path instead of waiting for the timeout.
//
// We deliberately do NOT reset on successful API responses, even though
// it was tempting: /api/v1/auth/session always returns 200 (per
// auth_session_handler.go contract) even when the response body says
// the user is unauthenticated. Resetting on that would cause the latch
// to flap and `navigateToReauth` to fire a second time, churning
// Authentik's state-JWT cookie and breaking any in-flight OAuth
// callback (state mismatch → "session ID mismatch" error).
let _authExpiredHandled = false
let _authExpiredTimer: ReturnType<typeof setTimeout> | null = null

function resetAuthExpiredLatch(): void {
  _authExpiredHandled = false
  if (_authExpiredTimer !== null) {
    clearTimeout(_authExpiredTimer)
    _authExpiredTimer = null
  }
}

/**
 * Test / dev hook — exposed for unit tests to reset the auth-expired
 * latch between runs without exposing the internal mutable state.
 * Test-setup.ts calls this in `beforeEach` to guarantee isolation
 * even when multiple tests in the same file exercise the auth path.
 */
export function _resetAuthExpiredLatch(): void {
  resetAuthExpiredLatch()
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', resetAuthExpiredLatch)
}

function handleAuthExpired(): void {
  if (_authExpiredHandled) return
  _authExpiredHandled = true
  _authExpiredTimer = setTimeout(resetAuthExpiredLatch, 30_000)
  navigateToReauth()
}

// --- Tesla Third-Party OAuth Grant Expiry Detection ---
//
// Distinct from the Authentik-session expiry path
// above. The Tesla third-party refresh token has a hard 8-week TTL; when
// it expires, the backend signals { code: 'TESLA_TOKEN_EXPIRED' } in a
// 401 body for any Tesla-backed call. Non-Tesla data continues to load
// normally — the SPA reacts by showing the <TeslaReauthBanner> recovery
// UI (a sticky top-of-page banner) rather than a full-screen blocker.
//
// We dispatch a single document-level CustomEvent so the banner (mounted
// in <Layout>) and the inline status pill in <TeslaAccountSection> can
// both pick up the same signal without prop-drilling. Tab-local only —
// cross-tab sync is intentionally OUT OF SCOPE; each tab will see its
// own first 401 and react independently.

/** Dispatches the per-tab "Tesla account disconnected" signal. */
function dispatchTeslaAuthExpired(): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-expired'))
}

// --- ForwardAuth session expiry signal ---
//
// Dispatched by `resilientFetch` when a non-/auth/session request
// returns 401 AND the structured-error code is NOT
// `TESLA_TOKEN_EXPIRED` (that case stays on the dedicated Tesla
// reauth banner). The {@link SessionExpiredModal} listens for this
// event and hard-blocks the UI until the user clicks "Sign in again".
//
// IMPORTANT: do NOT fire this event for /auth/session itself. The
// session-info endpoint is configured server-side to return 200 even
// when unauthenticated; if it ever returns a 401 (e.g. proxy
// misconfig), the polling SPA would dispatch the expired modal,
// which on close re-poll the same endpoint, infinite-loop.
function dispatchSessionExpired(): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(new CustomEvent('teslasync:session-expired'))
}

/**
 * Conditionally dispatches the session-expired signal — only when
 * `path` is NOT the polling endpoint that powers the modal itself.
 * Centralised here so every 401 branch can share the loop guard
 * without re-deriving it.
 */
function maybeDispatchSessionExpired(path: string): void {
  // Normalise: client.ts always passes paths with a leading slash; be
  // defensive in case a caller skipped that.
  const normalised = path.startsWith('/') ? path : `/${path}`
  if (normalised === '/auth/session') return
  dispatchSessionExpired()
}

// --- Resilient Fetch ---

interface ResilientOptions extends RequestInit {
  retries?: number        // max retries (default 1)
  retryDelay?: number     // initial delay ms (default 1000)
  timeout?: number        // request timeout ms (default 15000)
  dedupKey?: string       // dedup key for GET requests
  acceptedStatuses?: readonly number[]
}

// The retry loop uses `abortableSleep` so retries respond immediately
// to user navigation.

/** Custom error class for API responses. Includes the HTTP status code. */
export class ApiError extends Error {
  status: number
  /**
   * Optional machine-readable error code from the JSON body's `code` field.
   * Set when the backend response includes a structured error envelope so
   * the frontend can switch on error type without parsing strings.
   *
   * Used by {@link TeslaAuthExpiredError} to surface the dedicated
   * reauth banner without conflating with the Authentik-session 401
   * path.
   */
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    if (code) this.code = code
  }
}

/**
 * Thrown when the backend reports that the user's third-party Tesla OAuth
 * grant has expired (`code === 'TESLA_TOKEN_EXPIRED'` in a 401 body).
 *
 * Distinct from a generic 401 so consumers can `instanceof`-check it and
 * either (a) queue the failed mutation for replay after reconnect, or
 * (b) suppress noisy retry behaviour while the {@link TeslaReauthBanner}
 * is asking the user to re-authorize.
 *
 * The Authentik-session 401 path stays on the plain {@link ApiError} +
 * `handleAuthExpired()` overlay. Tesla token expiry is a *partial*
 * failure — non-Tesla data continues to load normally.
 */
export class TeslaAuthExpiredError extends ApiError {
  constructor(message: string) {
    super(message, 401, 'TESLA_TOKEN_EXPIRED')
    this.name = 'TeslaAuthExpiredError'
  }
}

// --- Rate-limit / circuit-breaker UX ---
//
// When the backend (or its upstream — Tesla Fleet API) returns 429 or
// 503 with a Retry-After header, the SPA needs to (a) tell the user
// what's happening with a calm countdown banner, (b) stop hammering
// the rate-limited endpoint with retries that will all be rejected,
// and (c) hand the user a "Retry now" button once the cooldown
// expires. The error types and module-level cache below power that
// behaviour; the banner UI lives in components/feedback/RateLimitBanner.

const DEFAULT_RETRY_AFTER_SEC = 60

/**
 * Thrown when an HTTP 429 is received. The SPA recognises this error
 * type to (a) show the <RateLimitBanner> countdown instead of a generic
 * "request failed" toast, and (b) short-circuit subsequent requests for
 * the same scope until the Retry-After window elapses.
 */
export class RateLimitError extends ApiError {
  retryAfterSec: number
  scope: string

  constructor(message: string, retryAfterSec: number, scope: string) {
    super(message, 429, 'RATE_LIMITED')
    this.name = 'RateLimitError'
    this.retryAfterSec = retryAfterSec
    this.scope = scope
  }
}

/**
 * Thrown when an upstream circuit breaker is open — the backend returns
 * 503 with `code === 'UPSTREAM_BREAKER_OPEN'` to signal that further
 * calls to the upstream will be fast-failed until the breaker probes
 * with a half-open call.
 *
 * Mapped to the same calm waiting placeholder as {@link RateLimitError}
 * via {@link isTransientWaiting} — both are "wait and try again", not
 * "the user did something wrong".
 */
export class UpstreamUnavailableError extends ApiError {
  retryAfterSec: number
  upstream: string

  constructor(message: string, retryAfterSec: number, upstream: string) {
    super(message, 503, 'UPSTREAM_BREAKER_OPEN')
    this.name = 'UpstreamUnavailableError'
    this.retryAfterSec = retryAfterSec
    this.upstream = upstream
  }
}

/**
 * Returns the first segment of an API path (e.g. "/vehicles/123/state"
 * → "/vehicles"). The rate-limit cooldown is keyed on this scope so
 * one 429 from `/vehicles/...` short-circuits all in-flight and queued
 * requests under `/vehicles/...` — finer per-resource granularity is
 * intentionally out of scope.
 */
export function pathScope(path: string): string {
  const trimmed = path.startsWith('/') ? path.slice(1) : path
  const idx = trimmed.indexOf('/')
  const head = idx === -1 ? trimmed : trimmed.slice(0, idx)
  // Strip query string from the segment (e.g. "vehicles?limit=10" → "vehicles").
  const q = head.indexOf('?')
  return '/' + (q === -1 ? head : head.slice(0, q))
}

const _rateLimited = new Map<string, number>()

function markRateLimited(scope: string, retryAfterSec: number): void {
  const safe = retryAfterSec > 0 ? retryAfterSec : DEFAULT_RETRY_AFTER_SEC
  _rateLimited.set(scope, Date.now() + safe * 1000)
}

function isRateLimited(path: string): { yes: boolean; retryAfterSec: number; scope: string } {
  const scope = pathScope(path)
  const exp = _rateLimited.get(scope)
  if (!exp) return { yes: false, retryAfterSec: 0, scope }
  if (Date.now() >= exp) {
    _rateLimited.delete(scope)
    return { yes: false, retryAfterSec: 0, scope }
  }
  return { yes: true, retryAfterSec: Math.ceil((exp - Date.now()) / 1000), scope }
}

/**
 * Test/dev hook — clear the in-process rate-limit short-circuit cache.
 * Exported with an underscore to signal it is NOT part of the public
 * API; tests reset state between runs by calling this.
 */
export function _resetRateLimitCache(): void {
  _rateLimited.clear()
}

function dispatchRateLimitedEvent(scope: string, retryAfterSec: number): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(
    new CustomEvent('teslasync:rate-limited', { detail: { scope, retryAfterSec } }),
  )
}

function dispatchUpstreamDownEvent(upstream: string, retryAfterSec: number): void {
  if (typeof document === 'undefined') return
  document.dispatchEvent(
    new CustomEvent('teslasync:upstream-down', { detail: { upstream, retryAfterSec } }),
  )
}

function parseRetryAfterHeader(value: string | null): number {
  if (!value) return DEFAULT_RETRY_AFTER_SEC
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n <= 0) return DEFAULT_RETRY_AFTER_SEC
  return n
}

/**
 * Type guard for {@link ApiError}. Use this in error-display components to
 * branch on `error.status` (404 / 401 / 5xx / network) rather than raw
 * `error instanceof Error` checks that lose the HTTP status.
 *
 * Survives the `instanceof` cliff that hits when bundlers split the
 * ApiError class across chunks — the duck-type fallback matches our error
 * shape while staying narrow enough to avoid false positives.
 */
export function isApiError(err: unknown): err is ApiError {
  if (err instanceof ApiError) return true
  if (err && typeof err === 'object' && 'name' in err && 'status' in err) {
    const e = err as { name: unknown; status: unknown }
    return (
      (e.name === 'ApiError' ||
        e.name === 'TeslaAuthExpiredError' ||
        e.name === 'RateLimitError' ||
        e.name === 'UpstreamUnavailableError') &&
      typeof e.status === 'number'
    )
  }
  return false
}

/**
 * Type guard for {@link TeslaAuthExpiredError}. Bundle-split safe via the
 * same duck-type fallback as {@link isApiError} — the bundler may emit
 * multiple copies of the class across chunks, so an `instanceof` check
 * alone is not enough at runtime.
 */
export function isTeslaAuthExpiredError(err: unknown): err is TeslaAuthExpiredError {
  if (err instanceof TeslaAuthExpiredError) return true
  if (err && typeof err === 'object' && 'name' in err && 'code' in err) {
    const e = err as { name: unknown; code: unknown }
    return e.name === 'TeslaAuthExpiredError' && e.code === 'TESLA_TOKEN_EXPIRED'
  }
  return false
}

/**
 * Type guard for {@link RateLimitError}. Bundle-split safe via the
 * same duck-type fallback as {@link isApiError}.
 */
export function isRateLimitError(err: unknown): err is RateLimitError {
  if (err instanceof RateLimitError) return true
  if (err && typeof err === 'object' && 'name' in err && 'status' in err && 'retryAfterSec' in err) {
    const e = err as { name: unknown; status: unknown; retryAfterSec: unknown }
    return e.name === 'RateLimitError' && e.status === 429 && typeof e.retryAfterSec === 'number'
  }
  return false
}

/**
 * Type guard for {@link UpstreamUnavailableError}. Bundle-split safe
 * via the same duck-type fallback as {@link isApiError}.
 */
export function isUpstreamUnavailableError(err: unknown): err is UpstreamUnavailableError {
  if (err instanceof UpstreamUnavailableError) return true
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err &&
    'upstream' in err
  ) {
    const e = err as { name: unknown; status: unknown; retryAfterSec: unknown }
    return (
      e.name === 'UpstreamUnavailableError' &&
      e.status === 503 &&
      typeof e.retryAfterSec === 'number'
    )
  }
  return false
}

/**
 * Performs a fetch request with automatic retry (exponential backoff),
 * request deduplication for GETs, and offline detection.
 *
 * Cancellation: when `options.signal` is provided (e.g. the `signal`
 * arg from a TanStack Query `queryFn`), the fetch + retry loop honours
 * abort. A user-side abort is propagated as the original `AbortError`
 * (NOT converted to a 408 timeout) and the retry loop exits without
 * additional network work.
 *
 * Dedup is automatically skipped when `options.signal` is present —
 * otherwise one caller aborting would reject the shared promise for
 * every other caller waiting on the same path.
 */
export async function resilientFetch<T>(
  path: string,
  options: ResilientOptions = {},
): Promise<T> {
  const {
    retries = 1,
    retryDelay = 1000,
    timeout = 15000,
    dedupKey,
    acceptedStatuses = [],
    ...fetchOpts
  } = options

  // For GET requests, auto-dedup using the path. We must NOT dedup when
  // the caller passes their own AbortSignal: the cached promise is shared
  // across callers, so one caller aborting would reject the promise
  // observed by every other (still-mounted) caller.
  const canDedup = !fetchOpts.signal
  const key = canDedup
    ? (dedupKey || ((!fetchOpts.method || fetchOpts.method === 'GET') ? path : ''))
    : ''
  if (key) {
    return dedup(
      key,
      () =>
        _doFetch<T>(
          path,
          fetchOpts,
          retries,
          retryDelay,
          timeout,
          acceptedStatuses,
        ),
    )
  }

  return _doFetch<T>(
    path,
    fetchOpts,
    retries,
    retryDelay,
    timeout,
    acceptedStatuses,
  )
}

/**
 * Sentinel reason attached when the internal timeout abort fires.
 * Used by `_doFetch` to distinguish a genuine user cancellation
 * (where we propagate the AbortError as-is and skip retries) from a
 * timeout-driven abort (where we surface an HTTP 408 ApiError).
 *
 * `AbortSignal.aborted` alone is not enough because the timeout
 * controller might race with a near-simultaneous user cancellation;
 * tagging the reason removes that race.
 */
const TIMEOUT_ABORT_REASON = Symbol('teslasync:timeout-abort')

/**
 * Race-safe abort sleep — resolves after `ms` or as soon as `signal`
 * aborts. Used between retries so a user navigation immediately stops
 * pending backoff instead of waiting for the next retry tick.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    let onAbort: (() => void) | null = null
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort)
      }
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    if (signal) {
      onAbort = () => {
        cleanup()
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * Combine a caller-provided AbortSignal with one or more internal
 * signals so the underlying fetch is aborted when any of them fires.
 *
 * Prefers the native `AbortSignal.any` (Node 22+, all current evergreen
 * browsers) and falls back to a manual chained controller when the
 * runtime doesn't provide it. Returned cleanup MUST be called in a
 * `finally` block to release the chained listeners (the manual fallback
 * would otherwise keep the user signal pinned for the lifetime of the
 * tab).
 */
function combineSignals(
  signals: Array<AbortSignal | undefined>,
): { signal: AbortSignal; cleanup: () => void } {
  const real = signals.filter((s): s is AbortSignal => Boolean(s))
  if (real.length === 1) {
    return { signal: real[0], cleanup: () => {} }
  }

  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === 'function') {
    return { signal: anyFn(real), cleanup: () => {} }
  }

  const ctrl = new AbortController()
  const listeners: Array<{ s: AbortSignal; fn: () => void }> = []
  for (const s of real) {
    if (s.aborted) {
      ctrl.abort((s as AbortSignal & { reason?: unknown }).reason)
      continue
    }
    const fn = () => {
      if (!ctrl.signal.aborted) ctrl.abort((s as AbortSignal & { reason?: unknown }).reason)
    }
    s.addEventListener('abort', fn, { once: true })
    listeners.push({ s, fn })
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      for (const { s, fn } of listeners) s.removeEventListener('abort', fn)
    },
  }
}

async function _doFetch<T>(
  path: string,
  fetchOpts: RequestInit,
  retries: number,
  retryDelay: number,
  timeout: number,
  acceptedStatuses: readonly number[],
): Promise<T> {
  let lastError: Error | null = null

  // Pull the user-provided signal out of the spread so we can merge
  // it explicitly with the per-attempt timeout signal further down,
  // rather than letting `...rest` accidentally clobber the timeout.
  // RequestInit.signal allows `null` for "explicit none"; coerce that
  // to undefined so the rest of the helper can branch on truthiness.
  const { signal: rawSignal, ...restOpts } = fetchOpts
  const userSignal: AbortSignal | undefined = rawSignal ?? undefined

  // Short-circuit any path whose scope is still
  // inside an active Retry-After window. Without this guard, 60 in-flight
  // queries to /vehicles would each independently hit the network during
  // the cooldown and each surface their own "request failed" toast. We
  // throw the cached RateLimitError so callers (banner, QueryError) see
  // the same shape they'd see from a fresh 429.
  const limited = isRateLimited(path)
  if (limited.yes) {
    throw new RateLimitError('Rate limited (cached)', limited.retryAfterSec, limited.scope)
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    // If the caller cancelled before this
    // attempt (e.g. between a 401 refresh + retry, or after an offline
    // check), bail out without issuing more network work.
    if (userSignal?.aborted) {
      throw new DOMException('aborted', 'AbortError')
    }

    if (!navigator.onLine) {
      setStatus('offline')
      throw new ApiError('No network connection', 0)
    }

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      controller.abort(TIMEOUT_ABORT_REASON)
    }, timeout)
    const merged = combineSignals([userSignal, controller.signal])

    try {
      // HELP-12: a fully-validated demo base is authoritative here too —
      // otherwise the retry/fallback path would silently reach the real API
      // while the direct path went to the fixtures, which is exactly the
      // "synthetic banner over production data" failure demo mode must not
      // have. `getDemoApiBase()` is null unless demo mode is completely
      // configured, so normal-mode traffic is unchanged.
      const demoBase = getDemoApiBase()
      const url = demoBase !== null
        ? `${demoBase}${path}`
        : `${getApiBase()}/api/v1${path}`
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...restOpts,
        ...(demoCredentialsMode() ? { credentials: demoCredentialsMode() } : {}),
        signal: merged.signal,
      })

      // Any server response (even errors) means we're online
      setStatus('online')

      // ── Auth middleware session expiry detection ──
      // When a ForwardAuth proxy (Authentik, Authelia, etc.) intercepts the
      // request after session expiry, the response is either a redirect
      // followed to an HTML login page, or a non-JSON 401.
      const contentType = res.headers.get('content-type') ?? ''

      if (res.ok && contentType.includes('text/html')) {
        // We asked for JSON from /api/v1 but got HTML — login page redirect
        maybeDispatchSessionExpired(path)
        handleAuthExpired()
        throw new ApiError('Authentication session expired', 401)
      }

      if (res.status === 401 && !contentType.includes('application/json')) {
        // 401 from auth middleware (our API always returns JSON on 401)
        maybeDispatchSessionExpired(path)
        handleAuthExpired()
        throw new ApiError('Authentication session expired', 401)
      }

      if (!res.ok && !acceptedStatuses.includes(res.status)) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        const errCode = typeof err.code === 'string' ? err.code : undefined
        const apiErr = new ApiError(err.error || `HTTP ${res.status}`, res.status, errCode)

        // Tesla third-party token expiry.
        // The backend signals this via { code: 'TESLA_TOKEN_EXPIRED' } in
        // a 401 body. Skip the auto-refresh-on-401 path (the Tesla refresh
        // already failed server-side, retrying client-side is pointless),
        // dispatch the recovery banner event, and throw a typed error so
        // mutation hooks can queue the failed call for replay after the
        // user reconnects.
        if (res.status === 401 && errCode === 'TESLA_TOKEN_EXPIRED') {
          dispatchTeslaAuthExpired()
          throw new TeslaAuthExpiredError(apiErr.message || 'Tesla account disconnected')
        }

        // Plain 401 (no TESLA_TOKEN_EXPIRED code) means the request was
        // rejected by the auth layer for non-Tesla reasons — typically a
        // ForwardAuth session expiry or a handler that requires a logged-in
        // user. Auto-refreshing the *Tesla OAuth token* (the previous
        // behaviour) does not help in either case and only generated 502
        // spam in open-mode installs that have no Tesla account linked.
        // Surface the SessionExpiredModal directly so the user can sign in
        // again. The /auth/session polling endpoint is excluded so the
        // polling SPA never dispatches its own hard-block on itself.
        if (res.status === 401) {
          maybeDispatchSessionExpired(path)
        }

        // 429 Rate Limited.
        // Read Retry-After (defaults to 60s when missing/invalid), mark
        // the path's scope as cooling down, dispatch the banner event,
        // and throw a typed RateLimitError. The previous behaviour
        // (silent 2s backoff retry then generic ApiError) hammered the
        // upstream and gave the user no visibility — both fixed here.
        if (res.status === 429) {
          const retryAfterSec = parseRetryAfterHeader(res.headers.get('Retry-After'))
          const scope = pathScope(path)
          markRateLimited(scope, retryAfterSec)
          dispatchRateLimitedEvent(scope, retryAfterSec)
          throw new RateLimitError(
            apiErr.message || 'Rate limited',
            retryAfterSec,
            scope,
          )
        }

        // 503 with UPSTREAM_BREAKER_OPEN.
        // The Tesla upstream breaker has tripped; further calls would
        // be fast-failed. Dispatch the upstream-down banner event and
        // throw a typed UpstreamUnavailableError so the calm waiting
        // placeholder is rendered instead of a generic server-error.
        if (res.status === 503 && errCode === 'UPSTREAM_BREAKER_OPEN') {
          const retryAfterSec = parseRetryAfterHeader(res.headers.get('Retry-After'))
          const upstream = typeof err.upstream === 'string' ? err.upstream : 'tesla'
          dispatchUpstreamDownEvent(upstream, retryAfterSec)
          throw new UpstreamUnavailableError(
            apiErr.message || 'Upstream temporarily unavailable',
            retryAfterSec,
            upstream,
          )
        }

        throw apiErr
      }

      const parsed = camelCaseKeys(await res.json())
      return parsed as T
    } catch (err) {
      if (err instanceof ApiError) throw err

      // Distinguish user-cancel from internal timeout.
      // If the caller's signal aborted, propagate the original AbortError
      // unchanged: no retry, no 408 conversion, no CORS probe — the user
      // has navigated away or the query was cancelled by TanStack Query.
      if (userSignal?.aborted) {
        const aborted = err instanceof Error
          ? err
          : new DOMException('aborted', 'AbortError')
        if (aborted.name !== 'AbortError') {
          throw new DOMException('aborted', 'AbortError')
        }
        throw aborted
      }

      // Network error might be a CORS-blocked auth redirect
      // (ForwardAuth redirected to external auth domain, browser blocked it).
      // Skip the probe entirely if the caller has cancelled — the probe
      // would be wasted work and could trigger the auth-expired flow on a
      // page the user has already left.
      if (err instanceof TypeError && !userSignal?.aborted) {
        try {
          const probe = await fetch(`${getApiBase()}/api/v1/system/version`, { method: 'HEAD' })
          if (!probe.ok || (probe.headers.get('content-type') ?? '').includes('text/html')) {
            handleAuthExpired()
            throw new ApiError('Authentication session expired', 401)
          }
        } catch (probeErr) {
          if (probeErr instanceof ApiError) throw probeErr
          handleAuthExpired()
          throw new ApiError('Authentication session expired', 401)
        }
      }

      // DOMException may not extend Error in
      // every runtime (notably some jsdom builds), so check the abort
      // name on the raw thrown value before wrapping it as Error.
      const errName =
        err instanceof Error
          ? err.name
          : typeof (err as { name?: unknown })?.name === 'string'
            ? (err as { name: string }).name
            : ''
      const isAbort = errName === 'AbortError'

      lastError = err instanceof Error ? err : new Error(String(err))

      if (isAbort) {
        // Internal timeout — surface as HTTP 408 so the existing UI
        // continues to render the timeout placeholder.
        lastError = new ApiError('Request timed out', 408)
      }

      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5)
        await abortableSleep(delay, userSignal)
        if (userSignal?.aborted) {
          throw new DOMException('aborted', 'AbortError')
        }
        continue
      }
    } finally {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      merged.cleanup()
    }
  }

  throw lastError || new ApiError('Request failed', 0)
}

// --- System Status Polling ---

export interface SystemStatus {
  overall: string
  database: { status: string; consecutive_failures?: number }
  /**
   * `breaker` and `breaker_reset_at` are exposed by the backend so the
   * SPA can show an accurate breaker-open banner
   * with a real countdown rather than re-deriving the reset window
   * client-side. `breaker_reset_at` is RFC3339 and only present while
   * the breaker is in the "open" state.
   */
  tesla_api: {
    status: string
    breaker?: 'open' | 'half-open' | 'closed' | string
    breaker_reset_at?: string
  }
  mqtt?: { status: string; consecutive_failures?: number; last_error?: string }
  worker?: { status: string; consecutive_failures?: number }
}

/** Fetches the backend system health status. */
export async function fetchSystemStatus(): Promise<SystemStatus> {
  return resilientFetch<SystemStatus>('/system/status', { retries: 0, timeout: 10000 })
}
