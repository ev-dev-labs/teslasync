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

// Native parity port of web/src/lib/errorReporter.ts.
//
// All of the reporter's logic — bucketing/coalescing, the offline send
// buffer, the in-app feedback ring buffer, the consent gate, and the
// idempotent install — is non-visual utility code and is ported
// byte-for-byte. The browser boundaries are crossed through `globalThis`
// accessors (the established native idiom, see columnOrderStore.ts) so the
// module compiles and runs under Hermes (React Native) while still behaving
// identically under the react-native-web build where the real `window` /
// `navigator` / `fetch` exist:
//
//   - `import.meta.env.PROD` (Vite-only) -> a `__DEV__`-derived `isProdBuild()`
//     so the reporter still only ships in release builds, matching the web
//     "don't report dev noise" intent. `__DEV__` is read via globalThis
//     because react-native's ambient global is not in scope for an
//     import-free module.
//   - `window.location.pathname` -> globalThis.location?.pathname ?? '/'.
//   - `navigator.onLine` / `navigator.userAgent` -> globalThis.navigator?.* with
//     the same online-by-default / empty-UA fallbacks the source used when
//     `navigator` is absent.
//   - `fetch` -> globalThis.fetch (React Native ships a global fetch, so the
//     POST path stays functional). The `keepalive` init is preserved verbatim;
//     runtimes that don't honor it simply ignore it.
//   - `window.addEventListener('error'|'unhandledrejection'|'online', …)` ->
//     attached only when a window-like object with addEventListener exists
//     (react-native-web); under Hermes the function takes the source's
//     `typeof window === 'undefined'` early-return after marking installed.
//
// The two web dependencies are NOT yet ported into the native parity tree, so
// the predicates this module needs are inlined native-safe (same pattern used
// by dateFormat.ts -> isFiniteNumber and FeedbackModal.tsx -> FeedbackErrorReport):
//   - ./resilience  -> isRateLimitError / isUpstreamUnavailableError reproduced
//     via the source's own bundle-split duck-type checks (a real RateLimitError
//     / UpstreamUnavailableError instance also satisfies them, so dropping the
//     `instanceof` fast-path is behavior-equivalent for shouldSkip()).
//   - ./cookieConsent -> isReportingAllowed + a minimal getConsent() reading
//     `teslasync:consent:v1` from globalThis.localStorage. Under Hermes there is
//     no localStorage, so consent collapses to 'unknown' (the documented native
//     CookieConsentBanner behaviour) which correctly blocks consent-gated POSTs.

const ENDPOINT = '/api/v1/web-errors';
const COALESCE_WINDOW_MS = 60_000;
const MAX_BUFFER_SIZE = 20;
// How many most-recent reports we keep around for the in-app feedback
// modal. Independent of the offline send buffer
// above so reports remain available for attachment after they have
// successfully been POSTed.
const FEEDBACK_RING_SIZE = 10;

// Storage key + tri-state mirror of the (unported) cookieConsent module,
// inlined so the reporter's consent gate behaves identically.
const CONSENT_STORAGE_KEY = 'teslasync:consent:v1';
type ConsentState = 'unknown' | 'accepted' | 'declined';

/**
 * A captured frontend error in the shape the in-app feedback modal
 * attaches to a user report. snake_case keys match the JSONB column
 * the backend persists into `user_feedback.recent_errors`.
 */
export interface FeedbackErrorReport {
  name: string;
  message: string;
  stack?: string;
  route: string;
  occurred_at: string;
  source: ErrorSource;
}

/**
 * Source channel that originated the report. Used internally to
 * disambiguate buckets; not transmitted in the payload because the
 * backend already bounds label cardinality on `name`.
 */
export type ErrorSource = 'window' | 'promise' | 'react' | 'query';

interface FrontendErrorPayload {
  name: string;
  message: string;
  stack?: string;
  route: string;
  userAgent: string;
  occurredAt: string;
}

interface BufferedSend {
  payload: FrontendErrorPayload;
}

interface ReporterState {
  installed: boolean;
  // bucketKey → epoch-ms timestamp of the most recent POST for the bucket
  buckets: Map<string, number>;
  buffer: BufferedSend[];
  // Most-recent reports surface in <FeedbackModal> so users can
  // attach diagnostic context to a bug report. Kept
  // separate from `buffer` (which exists only for offline retry) so a
  // successfully-POSTed report is still attachable.
  feedbackRing: FeedbackErrorReport[];
  enabledOverride?: boolean;
  // Deployment-wide GDPR / ePrivacy gate. When true,
  // isEnabled() short-circuits unless the user has
  // explicitly accepted via the cookie consent banner.
  requireCookieConsent: boolean;
}

const state: ReporterState = {
  installed: false,
  buckets: new Map(),
  buffer: [],
  feedbackRing: [],
  requireCookieConsent: false,
};

// ─── Native-safe browser-global accessors ───────────────────────────
// Each crosses a browser boundary through globalThis so the module runs
// under Hermes (where these are absent) and react-native-web (where they
// resolve to the real window/navigator/fetch/localStorage).

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  keepalive?: boolean;
};
type FetchFn = (input: string, init?: FetchInit) => Promise<unknown>;

interface WindowLike {
  addEventListener(type: string, handler: (event: unknown) => void): void;
}

function isProdBuild(): boolean {
  // Mirror Vite's `import.meta.env.PROD`: production ⇔ a release bundle,
  // which React Native signals via `__DEV__ === false`. When the flag is
  // absent we conservatively treat the build as non-production so the
  // reporter stays silent (matching the web dev/test default).
  return (globalThis as {__DEV__?: boolean}).__DEV__ === false;
}

function getStoredConsent(): ConsentState {
  const ls = (globalThis as {localStorage?: {getItem(key: string): string | null}})
    .localStorage;
  if (!ls) {
    return 'unknown';
  }
  try {
    const raw = ls.getItem(CONSENT_STORAGE_KEY);
    if (raw === 'accepted' || raw === 'declined') {
      return raw;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function isReportingAllowed(requireCookieConsent: boolean): boolean {
  if (!requireCookieConsent) {
    return true;
  }
  return getStoredConsent() === 'accepted';
}

function isRateLimitError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err
  ) {
    const e = err as {name: unknown; status: unknown; retryAfterSec: unknown};
    return (
      e.name === 'RateLimitError' &&
      e.status === 429 &&
      typeof e.retryAfterSec === 'number'
    );
  }
  return false;
}

function isUpstreamUnavailableError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err &&
    'upstream' in err
  ) {
    const e = err as {name: unknown; status: unknown; retryAfterSec: unknown};
    return (
      e.name === 'UpstreamUnavailableError' &&
      e.status === 503 &&
      typeof e.retryAfterSec === 'number'
    );
  }
  return false;
}

/**
 * Push the deployment-wide consent requirement down into the reporter.
 * Called from main.tsx once the
 * `/system/version` query resolves. Mid-session flips are honored on
 * the next captured error.
 */
export function setErrorReporterConsentRequirement(required: boolean): void {
  state.requireCookieConsent = Boolean(required);
}

function isEnabled(): boolean {
  if (state.enabledOverride !== undefined) {
    return state.enabledOverride;
  }
  // Web errors only get reported in production builds — dev errors come
  // from HMR reloads, StrictMode double-invokes, or work-in-progress
  // code that hasn't been pushed yet, all of which would create noise.
  if (!isProdBuild()) {
    return false;
  }
  // When the deployment requires consent and the user has not yet
  // accepted, suppress wire reporting. The
  // feedback ring buffer is unaffected because it never leaves the
  // browser; it is only consumed by the in-app feedback modal.
  if (!isReportingAllowed(state.requireCookieConsent)) {
    return false;
  }
  return true;
}

function isOffline(): boolean {
  const nav = (globalThis as {navigator?: {onLine?: boolean}}).navigator;
  return typeof nav !== 'undefined' && nav.onLine === false;
}

function nameOf(err: unknown): string {
  if (
    err instanceof Error &&
    typeof err.name === 'string' &&
    err.name.length > 0
  ) {
    return err.name;
  }
  if (typeof err === 'string') {
    return 'Error';
  }
  return 'Error';
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message && err.message.length > 0 ? err.message : String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function stackOf(err: unknown): string | undefined {
  if (
    err instanceof Error &&
    typeof err.stack === 'string' &&
    err.stack.length > 0
  ) {
    return err.stack;
  }
  return undefined;
}

function shouldSkip(err: unknown): boolean {
  if (err === null || err === undefined) {
    return true;
  }
  // Transient infra signals already drive their own UI surfaces — they
  // are not bugs and would mask real issues if reported here.
  if (isRateLimitError(err)) {
    return true;
  }
  if (isUpstreamUnavailableError(err)) {
    return true;
  }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'CanceledError')
  ) {
    return true;
  }
  return false;
}

function bucketKey(source: ErrorSource, payload: FrontendErrorPayload): string {
  // Source is part of the key so the same TypeError happening in
  // `window` vs `query` gets two POSTs (one per origin). The wire
  // payload still omits `source` to keep label cardinality bounded.
  return `${source}\u0000${payload.name}\u0000${payload.message}\u0000${payload.route}`;
}

function shouldCoalesce(key: string, now: number): boolean {
  const last = state.buckets.get(key);
  if (last === undefined) {
    return false;
  }
  return now - last < COALESCE_WINDOW_MS;
}

function sendPayload(payload: FrontendErrorPayload): void {
  try {
    const fetchFn = (globalThis as {fetch?: unknown}).fetch;
    if (typeof fetchFn !== 'function') {
      return;
    }
    const sent = (fetchFn as FetchFn)(ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      // `keepalive` lets the request survive page unload — important
      // because errors often happen right before the user navigates
      // away (e.g. clicking Reload after the boundary fires).
      keepalive: true,
    });
    sent.catch(() => {
      /* swallow — telemetry is best-effort */
    });
  } catch {
    /* swallow — never let the reporter throw into its caller */
  }
}

function flushBuffer(): void {
  if (state.buffer.length === 0) {
    return;
  }
  const drained = state.buffer.splice(0, state.buffer.length);
  for (const item of drained) {
    sendPayload(item.payload);
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
  if (shouldSkip(err)) {
    return;
  }

  const payload: FrontendErrorPayload = {
    name: nameOf(err),
    message: messageOf(err),
    stack: stackOf(err),
    route: getRoute(),
    userAgent: getUserAgent(),
    occurredAt: new Date().toISOString(),
  };

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
  });

  if (!isEnabled()) {
    return;
  }

  const key = bucketKey(source, payload);
  const now = Date.now();
  if (shouldCoalesce(key, now)) {
    return;
  }
  state.buckets.set(key, now);

  if (isOffline()) {
    // Drop the oldest buffered report when the buffer is full so we
    // always preserve the most recent context — older errors are less
    // actionable by the time the user comes back online.
    if (state.buffer.length >= MAX_BUFFER_SIZE) {
      state.buffer.shift();
    }
    state.buffer.push({payload});
    return;
  }

  sendPayload(payload);
}

function getRoute(): string {
  const loc = (globalThis as {location?: {pathname?: string}}).location;
  if (loc && typeof loc.pathname === 'string') {
    return loc.pathname;
  }
  return '/';
}

function getUserAgent(): string {
  const nav = (globalThis as {navigator?: {userAgent?: string}}).navigator;
  if (nav && typeof nav.userAgent === 'string') {
    return nav.userAgent;
  }
  return '';
}

function pushFeedbackReport(report: FeedbackErrorReport): void {
  state.feedbackRing.push(report);
  if (state.feedbackRing.length > FEEDBACK_RING_SIZE) {
    state.feedbackRing.splice(0, state.feedbackRing.length - FEEDBACK_RING_SIZE);
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
  return state.feedbackRing.slice();
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
  if (state.installed) {
    return;
  }
  state.installed = true;

  const win = getWindowLike();
  if (!win) {
    return;
  }

  win.addEventListener('error', (event: unknown) => {
    // `e.error` is the actual thrown value when available; some legacy
    // sources only set `e.message` (e.g. cross-origin script errors)
    // in which case we synthesise a minimal Error wrapper.
    const e = event as {error?: unknown; message?: string};
    reportFrontendError(
      e.error ?? new Error(e.message || 'Unknown error'),
      'window',
    );
  });

  win.addEventListener('unhandledrejection', (event: unknown) => {
    const e = event as {reason?: unknown};
    reportFrontendError(e.reason, 'promise');
  });

  win.addEventListener('online', () => {
    flushBuffer();
  });
}

function getWindowLike(): WindowLike | undefined {
  const w = (globalThis as {window?: {addEventListener?: unknown}}).window;
  if (w && typeof w.addEventListener === 'function') {
    return w as unknown as WindowLike;
  }
  return undefined;
}

// ─── Test-only exports ──────────────────────────────────────────────
// These are exported for unit tests. Production callers must not use
// them — the underscore prefix is the convention.

export function __resetErrorReporterForTests(): void {
  state.installed = false;
  state.buckets.clear();
  state.buffer.length = 0;
  state.feedbackRing.length = 0;
  state.enabledOverride = undefined;
  // Restore the legacy "consent not required" baseline so existing
  // errorReporter tests continue to observe the
  // unchanged behaviour. The cookie consent unit tests reset the
  // localStorage gate independently in their own beforeEach.
  state.requireCookieConsent = false;
}

export function __setErrorReporterEnabledForTests(v: boolean | undefined): void {
  state.enabledOverride = v;
}

export function __getBufferedCountForTests(): number {
  return state.buffer.length;
}
