/**
 * Frontend error reporter — Phase 46 / Prompt 01.
 *
 * Captures uncaught browser errors (`window.error`,
 * `window.unhandledrejection`), React render errors (forwarded from
 * `<ErrorBoundary>.componentDidCatch`), and TanStack Query failures
 * (forwarded from `queryCache.subscribe`) and ships them to the
 * backend as a single POST per `(name+message+route)` bucket per
 * minute.
 *
 * Mirrors the design of the Web Vitals reporter (Phase 45 / Prompt 12) —
 * telemetry is best-effort, never propagated to the user, and gracefully
 * degrades when the device is offline.
 */

import { isRateLimitError, isUpstreamUnavailableError } from './resilience'

const ENDPOINT = '/api/v1/web-errors'
const COALESCE_WINDOW_MS = 60_000
const MAX_BUFFER_SIZE = 20

/**
 * Source channel that originated the report. Used internally to
 * disambiguate buckets; not transmitted in the payload because the
 * backend already bounds label cardinality on `name`.
 */
export type ErrorSource = 'window' | 'promise' | 'react' | 'query'

interface FrontendErrorPayload {
  name: string
  message: string
  stack?: string
  route: string
  userAgent: string
  occurredAt: string
}

interface BufferedSend {
  payload: FrontendErrorPayload
}

interface ReporterState {
  installed: boolean
  // bucketKey → epoch-ms timestamp of the most recent POST for the bucket
  buckets: Map<string, number>
  buffer: BufferedSend[]
  enabledOverride?: boolean
}

const state: ReporterState = {
  installed: false,
  buckets: new Map(),
  buffer: [],
}

function isEnabled(): boolean {
  if (state.enabledOverride !== undefined) return state.enabledOverride
  // Web errors only get reported in production builds — dev errors come
  // from HMR reloads, StrictMode double-invokes, or work-in-progress
  // code that hasn't been pushed yet, all of which would create noise.
  return Boolean(import.meta.env.PROD)
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function nameOf(err: unknown): string {
  if (err instanceof Error && typeof err.name === 'string' && err.name.length > 0) {
    return err.name
  }
  if (typeof err === 'string') return 'Error'
  return 'Error'
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message && err.message.length > 0 ? err.message : String(err)
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function stackOf(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === 'string' && err.stack.length > 0) {
    return err.stack
  }
  return undefined
}

function shouldSkip(err: unknown): boolean {
  if (err === null || err === undefined) return true
  // Transient infra signals already drive their own UI surfaces — they
  // are not bugs and would mask real issues if reported here.
  if (isRateLimitError(err)) return true
  if (isUpstreamUnavailableError(err)) return true
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'CanceledError')) {
    return true
  }
  return false
}

function bucketKey(source: ErrorSource, payload: FrontendErrorPayload): string {
  // Source is part of the key so the same TypeError happening in
  // `window` vs `query` gets two POSTs (one per origin). The wire
  // payload still omits `source` to keep label cardinality bounded.
  return `${source}\u0000${payload.name}\u0000${payload.message}\u0000${payload.route}`
}

function shouldCoalesce(key: string, now: number): boolean {
  const last = state.buckets.get(key)
  if (last === undefined) return false
  return now - last < COALESCE_WINDOW_MS
}

function sendPayload(payload: FrontendErrorPayload): void {
  try {
    if (typeof fetch !== 'function') return
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // `keepalive` lets the request survive page unload — important
      // because errors often happen right before the user navigates
      // away (e.g. clicking Reload after the boundary fires).
      keepalive: true,
    }).catch(() => {
      /* swallow — telemetry is best-effort */
    })
  } catch {
    /* swallow — never let the reporter throw into its caller */
  }
}

function flushBuffer(): void {
  if (state.buffer.length === 0) return
  const drained = state.buffer.splice(0, state.buffer.length)
  for (const item of drained) {
    sendPayload(item.payload)
  }
}

/**
 * Build a payload from an arbitrary thrown value, run through the
 * coalescing + offline-buffer logic, and POST when ready. Always a
 * no-op in dev mode and for transient infra signals (rate limit,
 * upstream unavailable, abort).
 *
 * Never throws — telemetry must not break the app.
 */
export function reportFrontendError(err: unknown, source: ErrorSource): void {
  if (!isEnabled()) return
  if (shouldSkip(err)) return

  const payload: FrontendErrorPayload = {
    name: nameOf(err),
    message: messageOf(err),
    stack: stackOf(err),
    route: typeof window !== 'undefined' ? window.location.pathname : '/',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    occurredAt: new Date().toISOString(),
  }

  const key = bucketKey(source, payload)
  const now = Date.now()
  if (shouldCoalesce(key, now)) return
  state.buckets.set(key, now)

  if (isOffline()) {
    // Drop the oldest buffered report when the buffer is full so we
    // always preserve the most recent context — older errors are less
    // actionable by the time the user comes back online.
    if (state.buffer.length >= MAX_BUFFER_SIZE) state.buffer.shift()
    state.buffer.push({ payload })
    return
  }

  sendPayload(payload)
}

/**
 * Attach `window.error` and `window.unhandledrejection` listeners that
 * forward to {@link reportFrontendError}, plus an `online` listener
 * that flushes any reports buffered while offline.
 *
 * Idempotent — calling more than once is a no-op so React StrictMode
 * double-invokes don't double-register listeners.
 */
export function installGlobalErrorReporting(): void {
  if (state.installed) return
  state.installed = true

  if (typeof window === 'undefined') return

  window.addEventListener('error', (e: ErrorEvent) => {
    // `e.error` is the actual thrown value when available; some legacy
    // sources only set `e.message` (e.g. cross-origin script errors)
    // in which case we synthesise a minimal Error wrapper.
    reportFrontendError(e.error ?? new Error(e.message || 'Unknown error'), 'window')
  })

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    reportFrontendError(e.reason, 'promise')
  })

  window.addEventListener('online', () => {
    flushBuffer()
  })
}

// ─── Test-only exports ──────────────────────────────────────────────
// These are exported for unit tests. Production callers must not use
// them — the underscore prefix is the convention.

export function __resetErrorReporterForTests(): void {
  state.installed = false
  state.buckets.clear()
  state.buffer.length = 0
  state.enabledOverride = undefined
}

export function __setErrorReporterEnabledForTests(v: boolean | undefined): void {
  state.enabledOverride = v
}

export function __getBufferedCountForTests(): number {
  return state.buffer.length
}
