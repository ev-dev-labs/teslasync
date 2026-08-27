/**
 * Web Vitals / RUM reporter — captures Core Web Vitals (LCP, INP, CLS) plus
 * FCP and TTFB on every real navigation, adds SPA navigation timings and a
 * bounded UX-event channel, and ships everything to
 * `POST /api/v1/web-vitals` where it is aggregated as Prometheus histograms
 * and counters.
 *
 * This reporter turns the engineering-guideline performance budget
 * (FCP < 1.5s on 4G) into something we can actually observe, and backs the
 * `frontend_*` SLOs in `slo/catalog.yaml`.
 *
 * ── Privacy contract ────────────────────────────────────────────────────────
 * Nothing that can identify a user, a vehicle or a location may leave the
 * browser through this module:
 *   - Routes are normalised to templates BEFORE they are queued. Numeric IDs,
 *     UUIDs, VINs, coordinates, e-mail addresses and opaque tokens collapse to
 *     `:id`; query strings and fragments are dropped entirely.
 *   - Dimensions come from closed sets (device class, effective connection
 *     class, theme). No user-agent string, no screen fingerprint, no
 *     IP-derived data, no geolocation.
 *   - `release` is build metadata (`VITE_APP_VERSION`), never user data.
 * The backend re-applies the identical normalisation, so a compromised client
 * cannot bypass it — this layer exists so the raw value never travels at all.
 *
 * ── Cardinality contract ────────────────────────────────────────────────────
 * Every label value this module produces is drawn from a closed set or from
 * the `:id`-collapsed route template space. Batches are chunked to the
 * server's per-request ceiling and the local queues are hard-capped so a
 * pathological page cannot grow memory without bound.
 *
 * ── Delivery ────────────────────────────────────────────────────────────────
 *   - Metrics are queued and flushed at most once per ~2s so we don't fire a
 *     request per metric. CLS in particular updates many times.
 *   - On `pagehide`/`visibilitychange:hidden` we flush synchronously so the
 *     last in-flight metrics arrive before the browser tears the page down.
 *     `navigator.sendBeacon` is preferred because it survives unload.
 *   - Reporter failures must NEVER propagate. Telemetry is best-effort by
 *     definition — a 500 on the ingest endpoint or a network blip must not
 *     surface to the user.
 *
 * ── Integration points ──────────────────────────────────────────────────────
 * 1. `startWebVitalsReporter()` is called exactly once from
 *    `web/src/main.tsx` (ADR-008 lock #6: RUM bootstraps in main.tsx only).
 *    It self-installs SPA navigation instrumentation by wrapping
 *    `history.pushState` / `history.replaceState` and listening for
 *    `popstate`, so no router, layout or page file needs to change. That
 *    yields `RouteChange` — a route *paint* signal (navigation start → first
 *    paint after the new route committed). It is NOT a usability signal.
 * 2. `TTUC` (time to usable content) is opt-in and tokenized. There is no
 *    automatic completion: two animation frames after a URL change say
 *    nothing about whether the route's primary data has rendered, so
 *    auto-completing TTUC would fabricate a metric. A page opts in with:
 *
 *        const token = useRef(currentNavigationToken())
 *        useEffect(() => {
 *          if (!isLoading && data) markContentReady(token.current)
 *        }, [isLoading, data])
 *
 *    The token pins the measurement to the navigation that was live when the
 *    page mounted, so a rapid A→B→C navigation can never complete an older
 *    navigation or attribute it to a newer route. Until pages are wired,
 *    `teslasync_frontend_time_to_usable_content_seconds` legitimately has no
 *    samples and therefore has NO SLO — see
 *    `docs/runbooks/frontend-rum-slos.md` §"Gated: TTUC readiness".
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { getConsent, subscribeConsent, type ConsentState } from './cookieConsent'
import { normalizeRouteTemplate } from './routeTemplate'
import {
  getVitalsConsentDecision,
  resetVitalsConsentRequirementForTests,
  subscribeVitalsConsentPolicy,
} from './webVitalsConsent'

const ENDPOINT = '/api/v1/web-vitals'
const FLUSH_INTERVAL_MS = 2_000

/** Server-side per-request ceilings (internal/api/webvitals/handler.go). */
const MAX_METRICS_PER_REQUEST = 100
const MAX_EVENTS_PER_REQUEST = 100

/** Local queue ceilings. Beyond these the oldest entries are dropped. */
const MAX_QUEUED_METRICS = 500
const MAX_QUEUED_EVENTS = 500

export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'unknown'
export type ConnectionClass = 'slow-2g' | '2g' | '3g' | '4g' | '5g' | 'unknown'
export type ThemeClass = 'dark' | 'light' | 'unknown'
export type VitalsRating = 'good' | 'needs-improvement' | 'poor'

/** Closed set of UX event kinds accepted by the backend. */
export type UxEventKind =
  | 'error'
  | 'resource'
  | 'query'
  | 'retry'
  | 'cache'
  | 'cancellation'
  | 'user_action'

/** Closed set of UX event outcomes accepted by the backend. */
export type UxEventOutcome =
  | 'success'
  | 'failure'
  | 'hit'
  | 'miss'
  | 'timeout'
  | 'cancelled'
  | 'blocked'
  | 'retried'

export const UX_EVENT_KINDS: readonly UxEventKind[] = [
  'error',
  'resource',
  'query',
  'retry',
  'cache',
  'cancellation',
  'user_action',
]

export const UX_EVENT_OUTCOMES: readonly UxEventOutcome[] = [
  'success',
  'failure',
  'hit',
  'miss',
  'timeout',
  'cancelled',
  'blocked',
  'retried',
]

/** Batch-level bounded dimensions. */
export interface ReporterContext {
  device: DeviceClass
  connection: ConnectionClass
  release: string
  theme: ThemeClass
}

export interface VitalsPayload {
  name: string
  value: number
  id: string
  rating: VitalsRating
  navigationType?: string
  /** Normalised route TEMPLATE — never a raw URL. */
  route: string
  ts: number
}

export interface UxEventPayload {
  kind: UxEventKind
  outcome: UxEventOutcome
  route: string
  count?: number
}

/**
 * Immutable handle on one navigation.
 *
 * A token is minted at navigation start and never mutated. Every measurement
 * carries the token it was started with, so a measurement that resolves after
 * a newer navigation has begun is discarded instead of being misattributed to
 * the newer route.
 */
export interface NavigationToken {
  readonly id: number
  readonly route: string
  /** Navigation start on the `performance.now()` clock. */
  readonly startedAt: number
}

interface ReporterState {
  queue: VitalsPayload[]
  events: UxEventPayload[]
  flushScheduled: boolean
  started: boolean
  historyPatched: boolean
  resourceListenerInstalled: boolean
  /** The currently-live navigation. Replaced, never mutated. */
  navigation: NavigationToken
  /** Navigation id that has already reported TTUC, if any. */
  contentReadyForNavId: number | null
  unsubscribeConsent: (() => void) | null
  unsubscribeCookieConsent: (() => void) | null
  /** Last observed user consent decision, used to detect transitions. */
  lastConsent: ConsentState
}

function freezeToken(token: NavigationToken): NavigationToken {
  return Object.freeze({ ...token })
}

const INITIAL_NAVIGATION = freezeToken({ id: 0, route: '/', startedAt: 0 })

const state: ReporterState = {
  queue: [],
  events: [],
  flushScheduled: false,
  started: false,
  historyPatched: false,
  resourceListenerInstalled: false,
  navigation: INITIAL_NAVIGATION,
  contentReadyForNavId: null,
  unsubscribeConsent: null,
  unsubscribeCookieConsent: null,
  lastConsent: 'unknown',
}

// ─────────────────────────────────────────────────────────────────────────────
// Route normalisation (privacy + cardinality)
//
// The normaliser itself lives in `./routeTemplate` — a pure, registry-aware,
// side-effect-free module shared with `errorReporter`, so both client-boundary
// surfaces template routes identically. Re-exported here because it is part of
// this module's published contract.
// ─────────────────────────────────────────────────────────────────────────────

export { normalizeRouteTemplate } from './routeTemplate'

function currentRoute(): string {
  if (typeof window === 'undefined' || !window.location) return '/'
  return normalizeRouteTemplate(window.location.pathname || '/')
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded dimensions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Device class from viewport width only. Deliberately NOT derived from the
 * user-agent string: UA parsing is a fingerprinting surface and produces an
 * unbounded label space.
 */
export function getDeviceClass(): DeviceClass {
  if (typeof window === 'undefined') return 'unknown'
  const width =
    typeof window.innerWidth === 'number' && window.innerWidth > 0
      ? window.innerWidth
      : (window.screen?.width ?? 0)
  if (!width) return 'unknown'
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

interface NetworkInformationLike {
  effectiveType?: string
}

/**
 * Effective connection class from the Network Information API. Only the five
 * standard buckets are accepted; anything else (including a missing API, which
 * is the case in Safari and Firefox) reports "unknown".
 */
export function getConnectionClass(): ConnectionClass {
  if (typeof navigator === 'undefined') return 'unknown'
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection
  const effective = conn?.effectiveType?.toLowerCase()
  switch (effective) {
    case 'slow-2g':
    case '2g':
    case '3g':
    case '4g':
    case '5g':
      return effective
    default:
      return 'unknown'
  }
}

/** Theme class from the root element's theme classes set by ThemeProvider. */
export function getThemeClass(): ThemeClass {
  if (typeof document === 'undefined' || !document.documentElement) return 'unknown'
  const classes = document.documentElement.classList
  if (classes.contains('dark')) return 'dark'
  if (classes.contains('light-mode') || classes.contains('light')) return 'light'
  return 'unknown'
}

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/

/** Build metadata inlined by Vite. Validated so it can be a Prometheus label. */
export function getRelease(): string {
  const raw = (import.meta.env?.VITE_APP_VERSION ?? '').toString().trim()
  if (!raw || !RELEASE_PATTERN.test(raw)) return 'unknown'
  return raw
}

export function collectReporterContext(): ReporterContext {
  return {
    device: getDeviceClass(),
    connection: getConnectionClass(),
    release: getRelease(),
    theme: getThemeClass(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queueing
// ─────────────────────────────────────────────────────────────────────────────

function enqueue(metric: Metric): void {
  pushMetric({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    // Capture the route at metric time — by the time we flush the user may
    // already have navigated somewhere else.
    route: currentRoute(),
    ts: typeof performance !== 'undefined' ? performance.now() : 0,
  })
}

function pushMetric(payload: VitalsPayload): void {
  if (!Number.isFinite(payload.value) || payload.value < 0) return
  if (state.queue.length >= MAX_QUEUED_METRICS) state.queue.shift()
  state.queue.push(payload)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (state.flushScheduled) return
  state.flushScheduled = true
  setTimeout(() => {
    void flush()
  }, FLUSH_INTERVAL_MS)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public reporting contract
// ─────────────────────────────────────────────────────────────────────────────

/** Thresholds (ms) used to derive a rating for TeslaSync-specific timings. */
const NAV_THRESHOLDS: Record<'RouteChange' | 'TTUC', { good: number; ni: number }> = {
  RouteChange: { good: 200, ni: 500 },
  TTUC: { good: 2_500, ni: 4_000 },
}

function rateNavigation(name: 'RouteChange' | 'TTUC', durationMs: number): VitalsRating {
  const t = NAV_THRESHOLDS[name]
  if (durationMs <= t.good) return 'good'
  if (durationMs <= t.ni) return 'needs-improvement'
  return 'poor'
}

let navSeq = 0
let navIdSeq = 0

function reportNavigationTiming(
  name: 'RouteChange' | 'TTUC',
  durationMs: number,
  route: string,
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return
  navSeq += 1
  pushMetric({
    name,
    value: durationMs,
    id: `${name.toLowerCase()}-${navSeq}`,
    rating: rateNavigation(name, durationMs),
    route: normalizeRouteTemplate(route),
    ts: typeof performance !== 'undefined' ? performance.now() : 0,
  })
}

/**
 * Report an SPA route *paint* duration in milliseconds — navigation start to
 * the first paint after the new route committed.
 *
 * This is a responsiveness signal, NOT a usability signal: the route may have
 * painted skeletons. Time-to-usable-content is reported separately and only
 * when a page explicitly opts in via {@link markContentReady}.
 */
export function reportRouteTransition(durationMs: number, route?: string): void {
  reportNavigationTiming('RouteChange', durationMs, route ?? currentRoute())
}

/**
 * Report a time-to-usable-content duration in milliseconds.
 *
 * Low-level escape hatch for callers that measure the duration themselves.
 * Prefer the tokenized {@link markContentReady}, which cannot misattribute a
 * measurement across a rapid navigation.
 */
export function reportTimeToUsableContent(durationMs: number, route?: string): void {
  reportNavigationTiming('TTUC', durationMs, route ?? currentRoute())
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0
}

/**
 * Begin timing a navigation and return an immutable token for it.
 *
 * Called automatically by the history instrumentation; exported so a router
 * integration can mark a transition that does not go through
 * `history.pushState` (for example a `<Suspense>` boundary that resolves
 * before the URL changes).
 */
export function markNavigationStart(route?: string): NavigationToken {
  navIdSeq += 1
  const token = freezeToken({
    id: navIdSeq,
    route: route ? normalizeRouteTemplate(route) : currentRoute(),
    startedAt: now(),
  })
  state.navigation = token
  return token
}

/**
 * The token for the navigation that is live right now. Capture this when a
 * page mounts (e.g. into a ref) and pass it back to {@link markContentReady}.
 */
export function currentNavigationToken(): NavigationToken {
  return state.navigation
}

/**
 * Report time-to-usable-content for the navigation identified by `token`.
 *
 * Ignored — deliberately, silently — when:
 *   - the token is not the live navigation (the user navigated away before the
 *     page's primary data arrived; completing here would attribute a stale
 *     duration to a newer route), or
 *   - this navigation already reported TTUC (progressive rendering must emit
 *     exactly one sample per navigation).
 *
 * Returns true when a sample was recorded, so callers and tests can assert the
 * outcome instead of guessing.
 *
 * THE ONE INTEGRATION POINT a feature page would add:
 *
 *     const token = useRef(currentNavigationToken())
 *     useEffect(() => {
 *       if (!isLoading && data) markContentReady(token.current)
 *     }, [isLoading, data])
 */
export function markContentReady(token: NavigationToken): boolean {
  if (!token || typeof token.id !== 'number') return false
  if (token.id !== state.navigation.id) return false
  if (state.contentReadyForNavId === token.id) return false
  state.contentReadyForNavId = token.id
  reportNavigationTiming('TTUC', now() - token.startedAt, token.route)
  return true
}

/**
 * Record a bounded UX event (resource failure, query outcome, retry, cache
 * hit/miss, cancellation, user action). Values outside the closed sets are
 * dropped client-side so they never reach a Prometheus label.
 */
export function reportUxEvent(event: UxEventPayload): void {
  if (!UX_EVENT_KINDS.includes(event.kind)) return
  if (!UX_EVENT_OUTCOMES.includes(event.outcome)) return
  const count =
    typeof event.count === 'number' && Number.isFinite(event.count)
      ? Math.min(Math.max(Math.trunc(event.count), 1), 1000)
      : 1
  if (state.events.length >= MAX_QUEUED_EVENTS) state.events.shift()
  state.events.push({
    kind: event.kind,
    outcome: event.outcome,
    route: normalizeRouteTemplate(event.route || currentRoute()),
    count,
  })
  scheduleFlush()
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

function send(body: string): Promise<void> | void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(ENDPOINT, blob)) return
      // sendBeacon can refuse the payload when the queue is full; fall
      // through to fetch as a safety net.
    }
    if (typeof fetch === 'function') {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).then(
        () => undefined,
        () => undefined,
      )
    }
  } catch {
    // Telemetry is best-effort; drop the batch silently.
  }
}

export async function flush(): Promise<void> {
  state.flushScheduled = false
  if (state.queue.length === 0 && state.events.length === 0) return

  const decision = getVitalsConsentDecision()

  if (decision === 'hold') {
    // The deployment's `require_cookie_consent` policy has not resolved yet.
    // Fail CLOSED: nothing leaves the browser. Do NOT clear the queue and do
    // NOT re-arm a timer — `startWebVitalsReporter` subscribes to policy
    // resolution and flushes then, so the early (and most valuable) LCP/FCP/
    // TTFB samples survive an install where consent is not required.
    return
  }

  if (decision === 'drop') {
    // The user declined, or the policy requires consent and none was given.
    discardQueuedSamples()
    return
  }

  const context = collectReporterContext()

  // Chunk to the server's per-request ceiling so an unusually long-lived tab
  // never trips the 400 "batch too large" guard.
  while (state.queue.length > 0 || state.events.length > 0) {
    const metrics = state.queue.splice(0, MAX_METRICS_PER_REQUEST)
    const events = state.events.splice(0, MAX_EVENTS_PER_REQUEST)
    const body: Record<string, unknown> = { context, metrics }
    if (events.length > 0) body.events = events
    await send(JSON.stringify(body))
  }
}

/**
 * Synchronously destroy everything currently queued.
 *
 * Called whenever a sample can no longer legally be transmitted — either the
 * resolved policy says so, or the user's consent decision just changed. It is
 * deliberately synchronous: `setConsent()` dispatches its change event
 * synchronously, so the queue is gone before any code path can observe the new
 * (possibly permissive) decision and flush.
 */
function discardQueuedSamples(): void {
  state.queue.length = 0
  state.events.length = 0
}

/**
 * React to a change in the USER's consent decision.
 *
 * A sample must never cross a consent boundary. Anything already queued was
 * collected under the previous decision — before an Accept there was no lawful
 * basis for it, and after a Decline it must not linger — so every transition
 * discards the queue synchronously, BEFORE the new decision can authorise a
 * send. Consent changes are rare (a few per session at most) and samples are
 * re-collected continuously, so the cost is negligible next to the risk.
 */
function onConsentChanged(next: ConsentState): void {
  if (next === state.lastConsent) return
  state.lastConsent = next
  discardQueuedSamples()
}

// ─────────────────────────────────────────────────────────────────────────────
// SPA navigation instrumentation
// ─────────────────────────────────────────────────────────────────────────────

function afterPaint(cb: () => void): void {
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(cb)
      })
      return
    }
  } catch {
    // fall through to the timeout path
  }
  setTimeout(cb, 0)
}

function beginNavigation(): void {
  const token = markNavigationStart()
  afterPaint(() => {
    try {
      // Discard rather than misattribute: if a newer navigation started before
      // this one painted, the elapsed time no longer describes a completed
      // transition and the live route is not this token's route.
      if (state.navigation.id !== token.id) return
      reportNavigationTiming('RouteChange', now() - token.startedAt, token.route)
    } catch {
      // Instrumentation must never break navigation.
    }
  })
}

/**
 * Wrap `history.pushState` / `history.replaceState` and listen for `popstate`
 * so SPA route transitions are measured without importing anything into the
 * router, layout or page files (ADR-008 lock #6). Idempotent.
 */
export function installNavigationInstrumentation(): void {
  if (state.historyPatched) return
  if (typeof window === 'undefined' || typeof history === 'undefined') return

  // The patch survives module state resets (HMR, tests). Re-wrapping an
  // already-wrapped history would emit one metric per wrap layer.
  const marker = '__teslasyncRumPatched__'
  if ((history.pushState as unknown as Record<string, unknown>)[marker]) {
    state.historyPatched = true
    return
  }

  const wrap = <K extends 'pushState' | 'replaceState'>(method: K) => {
    const original = history[method].bind(history)
    const patched = function (
      this: History,
      ...args: Parameters<History[K]>
    ): ReturnType<History[K]> {
      const result = (original as (...a: unknown[]) => unknown)(
        ...args,
      ) as ReturnType<History[K]>
      try {
        beginNavigation()
      } catch {
        // Never let instrumentation crash the app.
      }
      return result
    }
    ;(patched as unknown as Record<string, unknown>)[marker] = true
    history[method] = patched as History[K]
  }

  wrap('pushState')
  wrap('replaceState')
  window.addEventListener('popstate', () => {
    try {
      beginNavigation()
    } catch {
      /* ignore */
    }
  })

  state.historyPatched = true
}

/**
 * Capture failed sub-resource loads (script, stylesheet, image, font) as a
 * bounded UX event. Uses the capture phase because resource errors do not
 * bubble. Deliberately records ONLY {kind, outcome, route} — the failing URL
 * is never sent, so a signed asset URL or a CDN token can never leak into a
 * Prometheus label. Idempotent.
 */
export function installResourceErrorInstrumentation(): void {
  if (state.resourceListenerInstalled) return
  if (typeof window === 'undefined') return

  window.addEventListener(
    'error',
    (event: Event) => {
      try {
        const target = event.target
        // A window-level script error has `window` as its target; only element
        // targets represent a failed sub-resource load.
        if (!target || target === window || !(target as HTMLElement).tagName) return
        reportUxEvent({ kind: 'resource', outcome: 'failure', route: currentRoute() })
      } catch {
        // Instrumentation must never break the page.
      }
    },
    true,
  )

  state.resourceListenerInstalled = true
}

/**
 * Start observing Web Vitals and reporting them to the backend.
 *
 * Idempotent: calling more than once is a no-op (web-vitals does not de-dupe
 * its own callbacks, so registering twice would double-report).
 */
export function startWebVitalsReporter(): void {
  if (state.started) return
  state.started = true

  // The initial page load is navigation #1. `startedAt: 0` anchors it to
  // `performance.timeOrigin`, so a page that calls markContentReady() during
  // the first render measures from real navigation start.
  navIdSeq += 1
  state.navigation = freezeToken({ id: navIdSeq, route: currentRoute(), startedAt: 0 })
  state.contentReadyForNavId = null

  // Flush as soon as the deployment consent policy resolves. Without this the
  // fail-closed HOLD state would strand the early LCP/FCP/TTFB samples on
  // installs where consent is not required.
  state.unsubscribeConsent = subscribeVitalsConsentPolicy(next => {
    if (next === 'unknown') return
    void flush()
  })

  // React to the USER's decision too. The policy subscription alone leaves a
  // race: with `required` + `unknown` consent, samples sit in the queue until
  // the 2s timer fires. If the user Accepts inside that window the decision
  // flips to `send` and those PRE-consent samples would ship. Subscribing here
  // discards them synchronously on the transition instead.
  state.lastConsent = getConsent()
  state.unsubscribeCookieConsent = subscribeConsent(onConsentChanged)

  // Each metric callback may be invoked multiple times as the metric value
  // updates over time (CLS especially). The backend treats each sample as an
  // independent observation in the histogram.
  onLCP(enqueue)
  onINP(enqueue)
  onCLS(enqueue)
  onFCP(enqueue)
  onTTFB(enqueue)

  installNavigationInstrumentation()
  installResourceErrorInstrumentation()

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flush()
      }
    })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      void flush()
    })
  }
}

// Test-only hook: reset internal state so individual tests can re-arm the
// reporter without leaking queued metrics across cases.
export function __resetWebVitalsReporterForTests(
  consentPolicy: 'unknown' | 'required' | 'not-required' = 'not-required',
): void {
  state.queue.length = 0
  state.events.length = 0
  state.flushScheduled = false
  state.started = false
  state.historyPatched = false
  // `resourceListenerInstalled` is deliberately NOT reset: the listener is
  // attached to `window` and survives a module-state reset, so re-arming the
  // flag would stack duplicate listeners across tests. The history patch is
  // guarded by a marker on `history.pushState` for the same reason.
  state.unsubscribeConsent?.()
  state.unsubscribeConsent = null
  state.unsubscribeCookieConsent?.()
  state.unsubscribeCookieConsent = null
  state.lastConsent = 'unknown'
  state.navigation = INITIAL_NAVIGATION
  state.contentReadyForNavId = null
  navSeq = 0
  navIdSeq = 0
  // Resolve the deployment policy explicitly. Defaults to a *resolved*
  // `not-required` install so send-path specs stay meaningful; pass `'unknown'`
  // to assert the fail-closed HOLD behaviour.
  resetVitalsConsentRequirementForTests(consentPolicy)
}
