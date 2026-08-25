/**
 * Web Vitals reporter — captures Core Web Vitals (LCP, INP, CLS) plus FCP
 * and TTFB on every real navigation and ships them to the backend so they
 * can be aggregated as Prometheus histograms.
 *
 * This reporter adds the real-world ingest path that turns
 * the engineering-guideline performance budget (FCP < 1.5s on 4G) into
 * something we can actually observe.
 *
 * Design notes:
 *   - Metrics are queued and flushed at most once per ~2s so we don't fire
 *     a request per metric. CLS in particular updates many times.
 *   - On `pagehide`/`visibilitychange:hidden` we flush synchronously so
 *     the last in-flight metrics arrive before the browser tears the page
 *     down. `navigator.sendBeacon` is preferred because it survives unload.
 *   - Reporter failures must NEVER propagate. Telemetry is best-effort by
 *     definition — a 500 on the ingest endpoint or a network blip should
 *     not surface to the user.
 */

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import {
  isVitalsReportingAllowed,
  resetVitalsConsentRequirementForTests,
} from './webVitalsConsent'

const ENDPOINT = '/api/v1/web-vitals'
const FLUSH_INTERVAL_MS = 2_000

export interface VitalsPayload {
  name: string
  value: number
  id: string
  rating: 'good' | 'needs-improvement' | 'poor'
  navigationType?: string
  route: string
  ts: number
}

interface ReporterState {
  queue: VitalsPayload[]
  flushScheduled: boolean
  started: boolean
}

const state: ReporterState = {
  queue: [],
  flushScheduled: false,
  started: false,
}

function enqueue(metric: Metric): void {
  state.queue.push({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    // Capture pathname at metric time — by the time we flush the user may
    // already have navigated to a different route.
    route: typeof window !== 'undefined' ? window.location.pathname : '/',
    ts: typeof performance !== 'undefined' ? performance.now() : 0,
  })
  scheduleFlush()
}

function scheduleFlush(): void {
  if (state.flushScheduled) return
  state.flushScheduled = true
  setTimeout(() => {
    void flush()
  }, FLUSH_INTERVAL_MS)
}

export async function flush(): Promise<void> {
  state.flushScheduled = false
  if (state.queue.length === 0) return
  // When the deployment requires cookie consent and the user has not yet
  // accepted, silently drop the
  // batch. The queue is splice-emptied so a future accept doesn't
  // back-flush historical metrics that pre-date the decision —
  // GDPR's "lawful basis at time of collection" requirement.
  if (!isVitalsReportingAllowed()) {
    state.queue.length = 0
    return
  }
  const batch = state.queue.splice(0)
  const body = JSON.stringify({ metrics: batch })

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      const accepted = navigator.sendBeacon(ENDPOINT, blob)
      if (accepted) return
      // sendBeacon can refuse the payload when the queue is full; fall
      // through to fetch as a safety net.
    }
    if (typeof fetch === 'function') {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
    }
  } catch {
    // Telemetry is best-effort; drop the batch silently.
  }
}

/**
 * Start observing Web Vitals and reporting them to the backend.
 *
 * Idempotent: calling more than once is a no-op (web-vitals does not
 * de-dupe its own callbacks, so registering twice would double-report).
 */
export function startWebVitalsReporter(): void {
  if (state.started) return
  state.started = true

  // Each metric callback may be invoked multiple times as the metric
  // value updates over time (CLS especially). The backend treats each
  // sample as an independent observation in the histogram.
  onLCP(enqueue)
  onINP(enqueue)
  onCLS(enqueue)
  onFCP(enqueue)
  onTTFB(enqueue)

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
export function __resetWebVitalsReporterForTests(): void {
  state.queue.length = 0
  state.flushScheduled = false
  state.started = false
  // Clear the consent gate so existing webVitalsReporter tests (which
  // run before any cookieConsent
  // setup) keep observing the legacy "always send" behaviour.
  resetVitalsConsentRequirementForTests()
}
