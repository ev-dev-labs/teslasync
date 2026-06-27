// Native parity port of web/src/lib/webVitalsReporter.ts.
//
// Web Vitals reporter — captures Core Web Vitals (LCP, INP, CLS) plus FCP and
// TTFB on every real navigation and ships them to the backend so they can be
// aggregated as Prometheus histograms.
//
// This reporter adds the real-world ingest path that turns the
// engineering-guideline performance budget (FCP < 1.5s on 4G) into something we
// can actually observe.
//
// Design notes (unchanged from web):
//   - Metrics are queued and flushed at most once per ~2s so we don't fire a
//     request per metric. CLS in particular updates many times.
//   - On app-hide we flush so the last in-flight metrics arrive before the OS
//     may suspend the process. A `navigator.sendBeacon` is preferred (when the
//     platform provides one) because it survives unload.
//   - Reporter failures must NEVER propagate. Telemetry is best-effort by
//     definition — a 500 on the ingest endpoint or a network blip should not
//     surface to the user.
//
// ## Native conversion (contract rules 4-7)
//
// The web reporter is built almost entirely on browser-only seams: the
// `web-vitals` package (which observes DOM rendering/network timings that do
// not exist in React Native), `navigator.sendBeacon`, `Blob`,
// `window.location.pathname`, `performance.now`, and the `document`
// `visibilitychange` / `window` `pagehide` lifecycle events. Following the
// sibling lib ports (cookieConsent.ts, broadcast.ts, automationSSE.ts) and the
// api/queryClient.ts AppState bridge, every seam is replaced by a native-safe
// equivalent that:
//   - keeps the full public API (setVitalsConsentRequirement, VitalsPayload,
//     flush, startWebVitalsReporter, __resetWebVitalsReporterForTests) and the
//     queue → coalesce → flush → consent-gate pipeline verbatim,
//   - resolves the relative '/api/v1/web-vitals' endpoint through the native
//     api base via apiUrl() so the same API path is hit from a device,
//   - reuses the already-ported isReportingAllowed() consent gate,
//   - replaces the browser-only `web-vitals` import with a structural
//     WebVitalsSource seam: a host injects the real observers via
//     {@link setWebVitalsSource} (the react-native-web build can wire the real
//     web-vitals package) and a global `webVitals`-shaped object is
//     auto-detected; on pure native no Core Web Vitals exist so the reporter
//     registers nothing and surfaces {@link WEB_VITALS_UNAVAILABLE_REASON},
//   - prefers a detected global `navigator.sendBeacon` + `Blob` (present on the
//     react-native-web build / a host polyfill) and otherwise falls through to
//     the React Native `fetch`, exactly mirroring the web preference order,
//   - captures the current route through a host-injectable provider
//     ({@link setVitalsRouteProvider}) or a detected global `location.pathname`,
//     defaulting to '/', and reads `performance.now()` only when present, and
//   - flushes on app-hide via React Native `AppState` (the established native
//     analog of `visibilitychange` → hidden / `pagehide`), additionally wiring
//     the real `document`/`window` listeners when a DOM is present.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only React Native AppState plus the sibling native
// api/client and cookieConsent parity helpers.

import {
  AppState,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import {apiUrl} from '../api/client';
import {isReportingAllowed} from './cookieConsent';

const ENDPOINT = '/api/v1/web-vitals';
const FLUSH_INTERVAL_MS = 2_000;

// Opt-in flag pushed by the bootstrap after the `/system/version` resolve. When
// `false` (the default for self-hosted installs), reporting flows unchanged.
// When `true`, every flush() gates on the user's stored consent state and
// silently drops the batch when the user has not yet accepted.
let requireCookieConsent = false;

/**
 * Update the deployment-wide consent gate. Called from the bootstrap once the
 * `/system/version` query resolves. Re-callable so a settings change that flips
 * the flag mid-session is honored on the next flush.
 */
export function setVitalsConsentRequirement(required: boolean): void {
  requireCookieConsent = Boolean(required);
}

export interface VitalsPayload {
  name: string;
  value: number;
  id: string;
  rating: 'good' | 'needs-improvement' | 'poor';
  navigationType?: string;
  route: string;
  ts: number;
}

/**
 * Structural replacement for the web-vitals `Metric` type. React Native's
 * tsconfig omits the DOM lib and web-vitals is not a native dependency, so only
 * the fields the reporter actually reads are modelled.
 */
export interface WebVitalsMetric {
  name: string;
  value: number;
  id: string;
  rating: VitalsPayload['rating'];
  navigationType?: string;
}

type MetricCallback = (metric: WebVitalsMetric) => void;

/**
 * The five web-vitals observer registrars the reporter subscribes to. A host
 * injects a conforming source via {@link setWebVitalsSource} (e.g. the real
 * `web-vitals` package on the react-native-web build); a global `webVitals`
 * object of this shape is also auto-detected.
 */
export interface WebVitalsSource {
  onLCP(cb: MetricCallback): void;
  onINP(cb: MetricCallback): void;
  onCLS(cb: MetricCallback): void;
  onFCP(cb: MetricCallback): void;
  onTTFB(cb: MetricCallback): void;
}

/**
 * Explicit unavailable reason, surfaced (and documented in the parity sidecar)
 * so callers/log readers can tell "no metrics observed yet" apart from "this
 * platform has no Core Web Vitals". LCP/INP/CLS/FCP/TTFB are browser
 * rendering/network metrics tied to the DOM; pure React Native has none. The
 * queue/flush/consent pipeline stays fully active so an injected source (or the
 * react-native-web build) reports with full parity.
 */
export const WEB_VITALS_UNAVAILABLE_REASON =
  'React Native has no Core Web Vitals (LCP/INP/CLS/FCP/TTFB are browser ' +
  'rendering/network metrics tied to the DOM); startWebVitalsReporter() ' +
  'registers no observers until a host injects a web-vitals-shaped source via ' +
  'setWebVitalsSource (the react-native-web browser build can wire the real ' +
  'web-vitals package). The queue/flush/consent pipeline is otherwise active.';

let injectedSource: WebVitalsSource | null = null;

/**
 * Wire (or clear) the web-vitals observer source. Passing `null` reverts to the
 * auto-detected global `webVitals`, otherwise the no-observer default. Intended
 * for hosts that provide real vitals (the react-native-web build / a custom RUM
 * shim) and for tests that feed synthetic metrics. Inject BEFORE
 * {@link startWebVitalsReporter} — start is idempotent and registers observers
 * only on its first call.
 */
export function setWebVitalsSource(source: WebVitalsSource | null): void {
  injectedSource = source;
}

function getGlobalWebVitals(): WebVitalsSource | null {
  const candidate = (globalThis as typeof globalThis & {webVitals?: unknown})
    .webVitals;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const source = candidate as Partial<WebVitalsSource>;
  return typeof source.onLCP === 'function' &&
    typeof source.onINP === 'function' &&
    typeof source.onCLS === 'function' &&
    typeof source.onFCP === 'function' &&
    typeof source.onTTFB === 'function'
    ? (candidate as WebVitalsSource)
    : null;
}

function resolveWebVitalsSource(): WebVitalsSource | null {
  if (injectedSource) {
    return injectedSource;
  }
  try {
    return getGlobalWebVitals();
  } catch {
    return null;
  }
}

// Native analog of `window.location.pathname`. React Native has no location, so
// a host may inject the current route (e.g. from React Navigation) and a global
// `location.pathname` (react-native-web build) is otherwise detected.
let routeProvider: (() => string) | null = null;

/**
 * Wire (or clear) the current-route provider used to tag each metric. Passing
 * `null` reverts to a detected global `location.pathname`, otherwise '/'. The
 * route is captured at metric time because by flush time the user may already
 * have navigated elsewhere.
 */
export function setVitalsRouteProvider(provider: (() => string) | null): void {
  routeProvider = provider;
}

function currentRoute(): string {
  if (routeProvider) {
    try {
      const route = routeProvider();
      if (typeof route === 'string' && route.length > 0) {
        return route;
      }
    } catch {
      // Fall through to the global / default route below.
    }
  }
  const loc = (
    globalThis as typeof globalThis & {location?: {pathname?: unknown}}
  ).location;
  if (loc && typeof loc.pathname === 'string' && loc.pathname.length > 0) {
    return loc.pathname;
  }
  return '/';
}

function nowMs(): number {
  const perf = (
    globalThis as typeof globalThis & {performance?: {now?: () => number}}
  ).performance;
  if (perf && typeof perf.now === 'function') {
    try {
      return perf.now();
    } catch {
      return 0;
    }
  }
  return 0;
}

interface ReporterState {
  queue: VitalsPayload[];
  flushScheduled: boolean;
  started: boolean;
  // Native-only: the AppState change subscription wired by start, removed by the
  // test reset so individual tests don't leak listeners across cases.
  appStateSubscription: NativeEventSubscription | null;
}

const state: ReporterState = {
  queue: [],
  flushScheduled: false,
  started: false,
  appStateSubscription: null,
};

function enqueue(metric: WebVitalsMetric): void {
  state.queue.push({
    name: metric.name,
    value: metric.value,
    id: metric.id,
    rating: metric.rating,
    navigationType: metric.navigationType,
    // Capture the route at metric time — by the time we flush the user may
    // already have navigated to a different route.
    route: currentRoute(),
    ts: nowMs(),
  });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (state.flushScheduled) {
    return;
  }
  state.flushScheduled = true;
  setTimeout(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
}

interface BeaconNavigator {
  sendBeacon(url: string, data?: unknown): boolean;
}

function getSendBeacon(): ((url: string, data: unknown) => boolean) | null {
  const nav = (
    globalThis as typeof globalThis & {navigator?: Partial<BeaconNavigator>}
  ).navigator;
  if (nav && typeof nav.sendBeacon === 'function') {
    const beacon = nav.sendBeacon.bind(nav);
    return (url, data) => beacon(url, data);
  }
  return null;
}

type BlobConstructorLike = new (
  parts: unknown[],
  options?: {type?: string},
) => unknown;

function getBlobConstructor(): BlobConstructorLike | null {
  const candidate = (globalThis as typeof globalThis & {Blob?: unknown}).Blob;
  return typeof candidate === 'function'
    ? (candidate as BlobConstructorLike)
    : null;
}

export async function flush(): Promise<void> {
  state.flushScheduled = false;
  if (state.queue.length === 0) {
    return;
  }
  // When the deployment requires cookie consent and the user has not yet
  // accepted, silently drop the batch. The queue is emptied so a future accept
  // doesn't back-flush historical metrics that pre-date the decision — GDPR's
  // "lawful basis at time of collection" requirement.
  if (!isReportingAllowed(requireCookieConsent)) {
    state.queue.length = 0;
    return;
  }
  const batch = state.queue.splice(0);
  const body = JSON.stringify({metrics: batch});
  const endpoint = apiUrl(ENDPOINT);

  try {
    const sendBeacon = getSendBeacon();
    if (sendBeacon) {
      const BlobCtor = getBlobConstructor();
      const payload = BlobCtor
        ? new BlobCtor([body], {type: 'application/json'})
        : body;
      const accepted = sendBeacon(endpoint, payload);
      if (accepted) {
        return;
      }
      // sendBeacon can refuse the payload when the queue is full; fall through
      // to fetch as a safety net.
    }
    if (typeof fetch === 'function') {
      await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body,
        keepalive: true,
      } as RequestInit);
    }
  } catch {
    // Telemetry is best-effort; drop the batch silently.
  }
}

interface VisibilityDocument {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  visibilityState?: string;
}

interface PageHideTarget {
  addEventListener(type: 'pagehide', listener: () => void): void;
}

function getVisibilityDocument(): VisibilityDocument | null {
  const candidate = (globalThis as typeof globalThis & {document?: unknown})
    .document;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const doc = candidate as Partial<VisibilityDocument>;
  return typeof doc.addEventListener === 'function'
    ? (candidate as VisibilityDocument)
    : null;
}

function getPageHideTarget(): PageHideTarget | null {
  const candidate = globalThis as typeof globalThis & Partial<PageHideTarget>;
  return typeof candidate.addEventListener === 'function'
    ? (candidate as PageHideTarget)
    : null;
}

// react-native-web build / a host with a real DOM: preserve the exact web
// `visibilitychange` → hidden and `pagehide` flush behavior. On pure native
// neither global exists, so nothing is wired here and AppState (below) covers
// the app-hide flush.
function wireBrowserLifecycleFlush(): void {
  const doc = getVisibilityDocument();
  if (doc) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') {
        void flush();
      }
    });
  }
  const pageTarget = getPageHideTarget();
  if (pageTarget) {
    pageTarget.addEventListener('pagehide', () => {
      void flush();
    });
  }
}

/**
 * Start observing Web Vitals and reporting them to the backend.
 *
 * Idempotent: calling more than once is a no-op (web-vitals does not de-dupe its
 * own callbacks, so registering twice would double-report).
 */
export function startWebVitalsReporter(): void {
  if (state.started) {
    return;
  }
  state.started = true;

  // Each metric callback may be invoked multiple times as the metric value
  // updates over time (CLS especially). The backend treats each sample as an
  // independent observation in the histogram.
  const source = resolveWebVitalsSource();
  if (source) {
    source.onLCP(enqueue);
    source.onINP(enqueue);
    source.onCLS(enqueue);
    source.onFCP(enqueue);
    source.onTTFB(enqueue);
  } else {
    console.warn(`webVitalsReporter: ${WEB_VITALS_UNAVAILABLE_REASON}`);
  }

  // Native analog of the web `visibilitychange` → hidden / `pagehide` flush:
  // when the app leaves the foreground the OS may suspend the JS context, so
  // flush queued metrics first. flush() is best-effort and a no-op on an empty
  // queue, so a redundant call from a peer lifecycle hook is harmless.
  state.appStateSubscription = AppState.addEventListener(
    'change',
    (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        void flush();
      }
    },
  );

  wireBrowserLifecycleFlush();
}

// Test-only hook: reset internal state so individual tests can re-arm the
// reporter without leaking queued metrics, listeners, or injected seams across
// cases.
export function __resetWebVitalsReporterForTests(): void {
  state.queue.length = 0;
  state.flushScheduled = false;
  state.started = false;
  const sub = state.appStateSubscription;
  if (sub && typeof sub.remove === 'function') {
    sub.remove();
  }
  state.appStateSubscription = null;
  injectedSource = null;
  routeProvider = null;
  // Clear the consent gate so existing webVitalsReporter tests (which run before
  // any cookieConsent setup) keep observing the legacy "always send" behaviour.
  requireCookieConsent = false;
}
