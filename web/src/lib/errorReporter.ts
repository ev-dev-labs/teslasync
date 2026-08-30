/**
 * Frontend error reporter.
 *
 * Captures uncaught browser errors (`window.error`,
 * `window.unhandledrejection`), React render errors (forwarded from
 * `<ErrorBoundary>.componentDidCatch`), and TanStack Query failures
 * (forwarded from `queryCache.subscribe`) and ships them to the
 * backend as a single POST per `(name+message+route)` bucket per
 * minute.
 *
 * Telemetry is best-effort, never propagated to the user, and gracefully
 * degrades when the device is offline.
 */

import { isRateLimitError, isUpstreamUnavailableError } from './resilience'
import { getConsent, subscribeConsent, type ConsentState } from './cookieConsent'
import { normalizeRouteTemplate, redactLocationInText } from './routeTemplate'
import {
  getVitalsConsentDecision,
  resetVitalsConsentRequirementForTests,
  setVitalsConsentRequirement,
  subscribeVitalsConsentPolicy,
  type VitalsConsentDecision,
} from './webVitalsConsent'
import { redactSensitiveText } from './privacy'

const ENDPOINT = '/api/v1/web-errors'
const COALESCE_WINDOW_MS = 60_000
const MAX_BUFFER_SIZE = 20
// How many most-recent reports we keep around for the in-app feedback
// modal. Independent of the offline send buffer
// above so reports remain available for attachment after they have
// successfully been POSTed.
const FEEDBACK_RING_SIZE = 10

/**
 * A captured frontend error in the shape the in-app feedback modal
 * attaches to a user report. snake_case keys match the JSONB column
 * the backend persists into `user_feedback.recent_errors`.
 */
export interface FeedbackErrorReport {
  name: string
  message: string
  stack?: string
  route: string
  occurred_at: string
  source: ErrorSource
}

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
  // Most-recent reports surface in <FeedbackModal> so users can
  // attach diagnostic context to a bug report. Kept
  // separate from `buffer` (which exists only for offline retry) so a
  // successfully-POSTed report is still attachable.
  feedbackRing: FeedbackErrorReport[]
  enabledOverride?: boolean
  /** Last observed user consent decision, used to detect transitions. */
  lastConsent: ConsentState
  unsubscribeConsentPolicy: (() => void) | null
  unsubscribeCookieConsent: (() => void) | null
}

const state: ReporterState = {
  installed: false,
  buckets: new Map(),
  buffer: [],
  feedbackRing: [],
  lastConsent: 'unknown',
  unsubscribeConsentPolicy: null,
  unsubscribeCookieConsent: null,
}

/**
 * Publish the deployment-wide consent policy.
 *
 * Accepts `undefined` for "not resolved yet" (query in flight, or
 * `/system/version` failed with no cached response) — the same tri-state the
 * Web Vitals reporter uses. Both reporters read ONE store
 * (`web/src/lib/webVitalsConsent.ts`) so their gates cannot drift apart, and
 * `<VitalsConsentPolicyGate>` is the only production caller.
 */
export function setErrorReporterConsentRequirement(required: boolean | undefined): void {
  setVitalsConsentRequirement(required)
}

/**
 * Resolve what may happen with a report right now.
 *
 * - `send` — transmit, and drain anything buffered.
 * - `hold` — the live policy has not resolved. Buffer, transmit nothing, and
 *   do NOT drain the offline buffer. Early boot errors are the most valuable
 *   ones, so they are kept rather than discarded.
 * - `drop`  — reporting is not permitted; discard the buffer too.
 */
function resolveDecision(): VitalsConsentDecision {
  // `false` is the explicit "off" switch used by the dev-mode spec.
  if (state.enabledOverride === false) return 'drop'
  // Web errors only get reported in production builds — dev errors come
  // from HMR reloads, StrictMode double-invokes, or work-in-progress
  // code that hasn't been pushed yet, all of which would create noise.
  // `__setErrorReporterEnabledForTests(true)` simulates a production build;
  // it does NOT bypass the consent gate.
  if (state.enabledOverride === undefined && !import.meta.env.PROD) return 'drop'
  return getVitalsConsentDecision()
}

/**
 * Synchronously destroy the offline/pending buffer.
 *
 * A buffered report must never cross a consent boundary: before an Accept
 * there was no lawful basis for it, and after a Decline it must not linger.
 * The feedback ring is untouched — it never leaves the browser.
 */
function discardPendingReports(): void {
  state.buffer.length = 0
}

function onConsentChanged(next: ConsentState): void {
  if (next === state.lastConsent) return
  state.lastConsent = next
  // Runs synchronously inside `setConsent()`, so the buffer is gone before any
  // later code can observe the new (possibly permissive) decision and flush.
  discardPendingReports()
}

function onConsentPolicyChanged(next: 'unknown' | 'required' | 'not-required'): void {
  if (next === 'unknown') return
  const decision = resolveDecision()
  if (decision === 'send') {
    flushBuffer()
    return
  }
  if (decision === 'drop') {
    discardPendingReports()
  }
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

/**
 * The full client-boundary scrub for free-text diagnostics.
 *
 * Order matters: the current URL is templated and its query/fragment removed
 * FIRST, then generic secret redaction runs. The other way round, a
 * `[REDACTED]` marker injected into a query string breaks URL boundary
 * detection and leaves `?secret=…#frag` residue behind.
 */
function scrubDiagnosticText(text: string): string {
  return redactSensitiveText(redactLocationInText(text))
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
  // Never drain while the policy is unresolved (`hold`) or reporting is
  // forbidden (`drop`). `drop` additionally destroys the buffer so a later
  // Accept cannot resurrect pre-consent reports.
  const decision = resolveDecision()
  if (decision === 'drop') {
    discardPendingReports()
    return
  }
  if (decision !== 'send') return
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
  if (shouldSkip(err)) return

  // ── Client-boundary privacy ─────────────────────────────────────────────
  // Every field below is scrubbed BEFORE the payload is constructed, because
  // a payload can be buffered for an arbitrarily long time (offline, or the
  // consent policy not yet resolved) and is then POSTed verbatim. Backend
  // normalisation is far too late: the raw value has already left the browser.
  //
  //   route          templated via the shared, registry-aware normaliser, so
  //                  `/s/share-token-abc` becomes `/s/:id` rather than being
  //                  preserved as an innocuous-looking word. Query and hash
  //                  are dropped by the normaliser and never retained.
  //   message/stack  generic secret redaction, then every verbatim occurrence
  //                  of the current URL (href / pathname / search / hash) is
  //                  replaced with the template, and query+hash are stripped
  //                  from any remaining absolute URL.
  //   userAgent      no URL content.
  //   occurredAt     timestamp only.
  const rawStack = stackOf(err)
  const payload: FrontendErrorPayload = {
    name: nameOf(err),
    message: scrubDiagnosticText(messageOf(err)),
    stack: rawStack === undefined ? undefined : scrubDiagnosticText(rawStack),
    route: normalizeRouteTemplate(
      typeof window !== 'undefined' ? window.location.pathname : '/',
    ),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    occurredAt: new Date().toISOString(),
  }

  // Always push into the feedback ring buffer — even in dev and even
  // when the upstream POST will be skipped by isEnabled() — so the
  // <FeedbackModal> can attach the most recent context regardless of
  // whether the report was actually shipped to the backend.
  pushFeedbackReport({
    name: payload.name,
    message: payload.message,
    stack: payload.stack,
    route: payload.route,
    occurred_at: payload.occurredAt,
    source,
  })

  const decision = resolveDecision()
  if (decision === 'drop') {
    // Not permitted. Also destroy anything already buffered so a later
    // Accept cannot resurrect reports captured under a "no" answer.
    discardPendingReports()
    return
  }

  const key = bucketKey(source, payload)
  const now = Date.now()
  if (shouldCoalesce(key, now)) return
  state.buckets.set(key, now)

  // `hold` means the live policy has not resolved yet: buffer, transmit
  // nothing. Early boot errors — the ones raised before React and the version
  // query have even started — are exactly the reports worth keeping, so they
  // wait here instead of being thrown away. They are drained by
  // `onConsentPolicyChanged` once (and only once) the policy resolves to a
  // state that permits sending.
  if (decision === 'hold' || isOffline()) {
    // Drop the oldest buffered report when the buffer is full so we
    // always preserve the most recent context — older errors are less
    // actionable by the time the user comes back online.
    if (state.buffer.length >= MAX_BUFFER_SIZE) state.buffer.shift()
    state.buffer.push({ payload })
    return
  }

  sendPayload(payload)
}
function pushFeedbackReport(report: FeedbackErrorReport): void {
  state.feedbackRing.push(report)
  if (state.feedbackRing.length > FEEDBACK_RING_SIZE) {
    state.feedbackRing.splice(0, state.feedbackRing.length - FEEDBACK_RING_SIZE)
  }
}

/**
 * Returns the most-recent {@link FeedbackErrorReport}s captured by the
 * reporter, oldest-first, capped at {@link FEEDBACK_RING_SIZE}. Used
 * by the in-app <FeedbackModal> to attach
 * diagnostic context to a user-submitted bug report.
 *
 * Returns a fresh array on every call so callers can safely mutate
 * without affecting the internal ring state.
 */
export function getRecentReportsForFeedback(): FeedbackErrorReport[] {
  return state.feedbackRing.slice()
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

  // Same tri-state gate as the Web Vitals reporter, from the same store.
  state.lastConsent = getConsent()
  state.unsubscribeCookieConsent = subscribeConsent(onConsentChanged)
  state.unsubscribeConsentPolicy = subscribeVitalsConsentPolicy(onConsentPolicyChanged)
}

// ─── Test-only exports ──────────────────────────────────────────────
// These are exported for unit tests. Production callers must not use
// them — the underscore prefix is the convention.

export function __resetErrorReporterForTests(): void {
  state.installed = false
  state.buckets.clear()
  state.buffer.length = 0
  state.feedbackRing.length = 0
  state.enabledOverride = undefined
  state.unsubscribeConsentPolicy?.()
  state.unsubscribeConsentPolicy = null
  state.unsubscribeCookieConsent?.()
  state.unsubscribeCookieConsent = null
  state.lastConsent = 'unknown'
  // Restore a *resolved* "consent not required" deployment so existing
  // errorReporter specs keep observing the unchanged send path. Pass
  // `'unknown'` to `resetVitalsConsentRequirementForTests` directly (or call
  // `setErrorReporterConsentRequirement(undefined)`) to assert the
  // fail-closed HOLD behaviour.
  resetVitalsConsentRequirementForTests('not-required')
}

/**
 * Simulate a production build for tests.
 *
 * `true` skips the DEV short-circuit but STILL consults the consent gate, so
 * specs can exercise send/hold/drop. `false` forces a hard "off". `undefined`
 * restores the real `import.meta.env.PROD` check.
 */
export function __setErrorReporterEnabledForTests(v: boolean | undefined): void {
  state.enabledOverride = v
}

export function __getBufferedCountForTests(): number {
  return state.buffer.length
}

/**
 * The payloads currently held in the offline / policy-hold buffer.
 * Returns copies so a spec can inspect exactly what WOULD be transmitted
 * without being able to mutate reporter state.
 */
export function __getBufferedPayloadsForTests(): FrontendErrorPayload[] {
  return state.buffer.map(item => ({ ...item.payload }))
}
