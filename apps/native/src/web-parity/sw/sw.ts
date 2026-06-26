/**
 * @module web-parity/sw/sw
 *
 * Native parity for the TeslaSync custom service worker
 * (web/src/sw/sw.ts).
 *
 * A service worker is a browser-only execution context. React Native (Hermes)
 * has no `ServiceWorkerGlobalScope`, no workbox precaching / runtime caching,
 * no Cache Storage API, no `push` / `notificationclick` / `install` /
 * `activate` lifecycle events, and no `registration.showNotification`. The
 * registration + lifecycle half of the web file therefore cannot execute
 * natively, so the SW *runtime* is reported as explicitly unavailable
 * ({@link SW_UNAVAILABLE_REASON}) instead of pretending OS push or offline
 * precaching work.
 *
 * The file's *pure, vendor-neutral logic* is ported faithfully so behaviour,
 * defaults, cache names, TTLs, and matchers stay pinned and testable:
 *   - the backend `webpush.Payload` wire contract ({@link PushPayload}),
 *   - the push-payload parse fallback ({@link parsePushPayload}) mirroring
 *     `event.data?.json() ?? {}` with the `event.data?.text()` catch path,
 *   - the notification-options builder ({@link buildNotification}) — including
 *     the duplicate-icon regression contract (`icon` is intentionally never
 *     set) and the `severity === 'critical'` → `requireInteraction` rule,
 *   - the notification-click target resolution
 *     ({@link resolveNotificationClickUrl}) mirroring `data?.url ?? '/'`,
 *   - the workbox runtime-cache route table ({@link RUNTIME_CACHE_ROUTES},
 *     {@link NAVIGATION_CACHE}) with cacheName / status / maxEntries /
 *     maxAgeSeconds and the origin + tile matcher predicates.
 *
 * No DOM-only modules are imported: the `workbox-*` packages from the source
 * are deliberately NOT pulled in (conversion contract rule 4). Their
 * configuration is reproduced as inert, typed data instead.
 */

// ─── Service-worker runtime availability ────────────────────────────────────
//
// Mirrors the source's whole SW-runtime surface (the `declare const self:
// ServiceWorkerGlobalScope` block, `precacheAndRoute` / `cleanupOutdatedCaches`,
// the `install` / `activate` lifecycle handlers, and
// `self.registration.showNotification`). None of it exists under Hermes, so the
// runtime is honest about being unavailable rather than silently no-op.

export const SW_UNAVAILABLE_REASON =
  'React Native has no ServiceWorkerGlobalScope: workbox precaching, runtime ' +
  'caching, push/notificationclick events, the install/activate lifecycle ' +
  '(skipWaiting + clients.claim), and registration.showNotification do not ' +
  'exist natively. OS push delivery and offline precaching require native ' +
  'modules (e.g. Notifee/FCM/APNs plus an HTTP cache) and are not provided ' +
  'by this parity port.';

export interface SwRuntimeStatus {
  readonly available: boolean;
  readonly reason: string;
}

/**
 * The single source of truth for "the service-worker runtime cannot run in
 * native". Returned by every registration / lifecycle helper below so callers
 * never assume OS push or precaching succeeded.
 */
export function getServiceWorkerRuntimeStatus(): SwRuntimeStatus {
  return {available: false, reason: SW_UNAVAILABLE_REASON};
}

/**
 * Probe for a host-provided `ServiceWorkerContainer`. Under react-native-web in
 * a real browser `navigator.serviceWorker` exists; under Hermes it does not.
 * Even when the container exists, this parity tree does not ship the workbox SW
 * bundle, so {@link registerTeslaSyncServiceWorker} still reports unavailable —
 * this predicate only reflects whether the *platform* could host a SW at all.
 */
export function isServiceWorkerSupported(): boolean {
  const nav = (globalThis as {navigator?: {serviceWorker?: unknown}}).navigator;
  return Boolean(nav && typeof nav.serviceWorker === 'object' && nav.serviceWorker !== null);
}

/**
 * Native counterpart of registering the custom SW (the source's
 * `precacheAndRoute(self.__WB_MANIFEST)` + `cleanupOutdatedCaches()` +
 * `registerRoute(...)` side effects). Always unavailable in the parity tree.
 */
export function registerTeslaSyncServiceWorker(): SwRuntimeStatus {
  return getServiceWorkerRuntimeStatus();
}

/**
 * Message contract used by `useRegisterSW()` to drive the "Update available —
 * reload" prompt. Mirrors `event.data?.type === 'SKIP_WAITING'`.
 */
export interface SwMessageLike {
  type?: string;
}

/**
 * Native parity for the source's `message` handler. A `SKIP_WAITING` message
 * would call `self.skipWaiting()` in the browser; natively there is no waiting
 * worker, so the unavailable runtime status is returned for that message and
 * `null` for everything else.
 */
export function handleServiceWorkerMessage(
  message?: SwMessageLike | null,
): SwRuntimeStatus | null {
  if (message?.type === 'SKIP_WAITING') {
    return getServiceWorkerRuntimeStatus();
  }
  return null;
}

// ─── Web Push: wire contract + notification builder ─────────────────────────

/**
 * Backend `webpush.Payload` contract carried in a push message body.
 *
 * `icon` is intentionally absent from the wire payload to avoid duplicate
 * notification icons. The interface also omits it so the handler cannot
 * populate `data.icon` unless the backend webpush.Payload contract is updated
 * first. Per-event contextual icons are future work.
 */
export interface PushPayload {
  title?: string;
  body?: string;
  badge?: string;
  tag?: string;
  url?: string;
  severity?: 'info' | 'warn' | 'critical' | string;
}

/**
 * Minimal mirror of `PushMessageData` (`event.data`): the push service hands
 * the SW an object exposing `json()` and `text()`. Modelled as an interface so
 * the parse logic stays runtime-agnostic and unit-testable.
 */
export interface PushMessageDataLike {
  json(): unknown;
  text(): string;
}

/** The `data` bag attached to a built notification (carries the click URL). */
export interface NotificationData {
  url: string;
}

/**
 * The subset of `NotificationOptions` the source builds. `icon` is
 * deliberately absent (duplicate-icon regression contract): the PWA manifest
 * icon already fills the thumbnail slot, so setting `icon` here would render a
 * second copy on Android.
 */
export interface NativeNotificationOptions {
  body: string;
  badge: string;
  tag?: string;
  data: NotificationData;
  requireInteraction: boolean;
}

export interface BuiltNotification {
  title: string;
  options: NativeNotificationOptions;
}

export const DEFAULT_NOTIFICATION_TITLE = 'TeslaSync';
// The small monochrome Android status-bar icon. The OS discards colour data
// and re-tints the alpha channel, so this MUST be a white silhouette on a
// transparent background.
// See: https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge
export const DEFAULT_NOTIFICATION_BADGE = '/icons/badge-72.png';
export const DEFAULT_NOTIFICATION_CLICK_URL = '/notifications/inbox';
export const FALLBACK_NOTIFICATION_CLICK_URL = '/';

/**
 * Parse a push message body into a typed {@link PushPayload}.
 *
 * Mirrors the source exactly: prefer the JSON body (`event.data?.json() ?? {}`)
 * and, when that throws (a non-JSON wake-up ping), fall back to a generic
 * notification whose body is the raw text (`event.data?.text() ?? ''`). Push
 * services occasionally deliver payload-less messages, so a missing `data`
 * collapses to an empty payload rather than throwing.
 */
export function parsePushPayload(data?: PushMessageDataLike | null): PushPayload {
  try {
    const parsed = data?.json();
    return (parsed as PushPayload | null | undefined) ?? {};
  } catch {
    return {body: data?.text() ?? ''};
  }
}

/**
 * Build the `(title, options)` pair the SW passes to `showNotification`.
 *
 * Pins the source defaults: title → `'TeslaSync'`, body → `''`, badge →
 * `'/icons/badge-72.png'`, click target → `'/notifications/inbox'`, and
 * `requireInteraction` true only for `severity === 'critical'` (info / warn use
 * the OS default decay). `icon` is intentionally never set.
 */
export function buildNotification(data: PushPayload): BuiltNotification {
  const title = data.title ?? DEFAULT_NOTIFICATION_TITLE;
  const options: NativeNotificationOptions = {
    body: data.body ?? '',
    // `icon` is intentionally NOT set — see PushPayload / the duplicate-icon
    // regression contract above.
    badge: data.badge ?? DEFAULT_NOTIFICATION_BADGE,
    tag: data.tag,
    data: {url: data.url ?? DEFAULT_NOTIFICATION_CLICK_URL},
    requireInteraction: data.severity === 'critical',
  };
  return {title, options};
}

/**
 * Native parity for the source's `push` handler body: parse the message data,
 * then build the notification. Display itself (`registration.showNotification`)
 * is unavailable natively — callers route {@link BuiltNotification} into a
 * native notification module instead.
 */
export function buildPushNotification(
  data?: PushMessageDataLike | null,
): BuiltNotification {
  return buildNotification(parsePushPayload(data));
}

/**
 * Resolve the URL a notification tap should open. Mirrors the source's
 * `(event.notification.data?.url as string | undefined) ?? '/'`. The
 * window-reuse / `clients.openWindow` plumbing around it is browser-only and is
 * documented as unavailable; this resolves the target the native router would
 * navigate to.
 */
export function resolveNotificationClickUrl(
  data?: Partial<NotificationData> | null,
): string {
  return data?.url ?? FALLBACK_NOTIFICATION_CLICK_URL;
}

// ─── Workbox runtime-cache configuration (ported as inert data) ──────────────
//
// Reproduces the three CacheFirst buckets + the NetworkFirst navigation route
// the source registered, so cache names, cacheable statuses, entry caps, and
// TTLs stay pinned. The matcher predicates are pure functions over the URL
// parts the source inspected (`url.origin`, `url.host`, `url.pathname`).

/** Subset of `URL` the source matchers read. */
export interface UrlLike {
  origin: string;
  host: string;
  pathname: string;
}

/** Google Fonts stylesheets — `url.origin === 'https://fonts.googleapis.com'`. */
export function isGoogleFontsStylesheet(url: UrlLike): boolean {
  return url.origin === 'https://fonts.googleapis.com';
}

/** Google Fonts webfont files — `url.origin === 'https://fonts.gstatic.com'`. */
export function isGoogleFontsWebfont(url: UrlLike): boolean {
  return url.origin === 'https://fonts.gstatic.com';
}

/**
 * Leaflet map tiles — host pattern matches OpenStreetMap, MapBox, etc.
 * Mirrors `/tile/i.test(url.host) || /\/tiles?\//i.test(url.pathname)`.
 */
export function isMapTile(url: UrlLike): boolean {
  return /tile/i.test(url.host) || /\/tiles?\//i.test(url.pathname);
}

export interface NavigationCacheConfig {
  readonly cacheName: string;
  readonly strategy: 'NetworkFirst';
  readonly networkTimeoutSeconds: number;
  readonly cacheableStatuses: readonly number[];
  readonly maxEntries: number;
  readonly maxAgeSeconds: number;
}

/**
 * NetworkFirst navigation route. A short network timeout keeps offline launch
 * working (returns the last cached navigation when the network is unreachable)
 * while still observing an Authentik 302 → login HTML as a real response so the
 * SPA's auth-expired handling can fire. `index.html` is intentionally NOT
 * precached to avoid the ForwardAuth refresh-loop bug.
 */
export const NAVIGATION_CACHE: NavigationCacheConfig = {
  cacheName: 'navigations',
  strategy: 'NetworkFirst',
  networkTimeoutSeconds: 3,
  cacheableStatuses: [200],
  maxEntries: 10,
  maxAgeSeconds: 60 * 60 * 24 * 7,
};

export interface RuntimeCacheRoute {
  readonly cacheName: string;
  readonly strategy: 'CacheFirst';
  readonly match: (url: UrlLike) => boolean;
  /** Statuses the CacheableResponsePlugin allows; absent ⇒ no such plugin. */
  readonly cacheableStatuses?: readonly number[];
  readonly maxEntries: number;
  readonly maxAgeSeconds: number;
}

/**
 * The three CacheFirst runtime buckets, in source registration order. Re-stated
 * here so SPA caching parity (names + TTLs + caps) is preserved if a native
 * HTTP cache is ever wired up.
 */
export const RUNTIME_CACHE_ROUTES: readonly RuntimeCacheRoute[] = [
  {
    cacheName: 'google-fonts-stylesheets',
    strategy: 'CacheFirst',
    match: isGoogleFontsStylesheet,
    maxEntries: 10,
    maxAgeSeconds: 60 * 60 * 24 * 365,
  },
  {
    cacheName: 'google-fonts-webfonts',
    strategy: 'CacheFirst',
    match: isGoogleFontsWebfont,
    cacheableStatuses: [0, 200],
    maxEntries: 30,
    maxAgeSeconds: 60 * 60 * 24 * 365,
  },
  {
    cacheName: 'map-tiles',
    strategy: 'CacheFirst',
    match: isMapTile,
    cacheableStatuses: [0, 200],
    maxEntries: 500,
    maxAgeSeconds: 60 * 60 * 24 * 30,
  },
];
