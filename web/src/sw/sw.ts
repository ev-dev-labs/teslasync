/// <reference lib="webworker" />
//
// TeslaSync custom service worker.
//
// vite-plugin-pwa is configured with strategies: 'injectManifest' so this
// file is bundled by the plugin and registered as the production SW.
//
// Responsibilities, in the order they appear below:
//   1. lifecycle          — install/activate WITHOUT forced skipWaiting
//   2. cache versioning   — every app-owned bucket carries the build id
//   3. precache + routing — install shell, navigations, route assets
//   4. API read cache     — a narrow allowlist with cached-at disclosure
//   5. web push           — device policy, sanitised deep links
//   6. page protocol      — typed postMessage handling
//
// Everything with real logic lives in a sibling pure module so it can be
// unit-tested without a ServiceWorkerGlobalScope.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

import {
  API_CONTRACT_VERSION,
  BUILD_ID,
  cacheName,
  isApiReadCacheName,
  staleCacheNames,
} from './buildContract'
import {
  API_CACHE_MAX_ENTRIES,
  CACHED_AT_HEADER,
  CACHE_SOURCE_CACHE,
  CACHE_SOURCE_HEADER,
  classifyApiRequest,
  isCacheableApiResponse,
  isCachedEntryExpired,
  readCachedAt,
} from './apiCachePolicy'
import { NOTIFICATION_FALLBACK_URL, sanitizeNotificationUrl } from './deepLink'
import {
  DEFAULT_DEVICE_NOTIFICATION_PREFS,
  evaluateNotification,
  sanitizeDeviceNotificationPrefs,
  type DeviceNotificationPrefs,
} from './notificationPolicy'
import {
  PAGE_TO_SW,
  SW_TO_PAGE,
  isPageToSwMessage,
  type CachedApiEntry,
  type SwStatusMessage,
} from './swProtocol'
import {
  TRIP_SHARE_TARGET_PATH,
  handleTripShareTargetRequest,
} from '../lib/tripShareTarget'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ── SW lifecycle: NO forced auto-update ────────────────────────────────────
//
// `registerType: 'prompt'` (vite.config.ts) means a freshly installed worker
// must sit in `waiting` until a page explicitly sends SKIP_WAITING. The
// previous build called `self.skipWaiting()` unconditionally in `install`,
// which silently swapped the running application out from under whatever the
// user was doing — including mid-form. Update sequencing is now owned by
// `hooks/usePwaUpdate.ts`, which checks for unsaved work and coordinates
// sibling tabs before releasing the waiting worker.
//
// `clients.claim()` on activate is still correct: by the time we activate,
// a page has already consented.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every TeslaSync-owned cache this build does not claim. Because
      // versioned bucket names embed BUILD_ID, this is what physically stops
      // a previous build's JavaScript, locale bundle, or cached API read from
      // being paired with the new API contract (PWA-04).
      const keys = await self.caches.keys()
      await Promise.all(
        staleCacheNames(keys).map((name) => self.caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

// Precache the build manifest. injectManifest substitutes
// `self.__WB_MANIFEST` with the list of build artefacts at build time.
//
// IMPORTANT: index.html is intentionally excluded from the build glob
// (see vite.config.ts injectManifest.globPatterns). Precaching the SPA
// shell behind a ForwardAuth proxy traps the user in a refresh loop on
// session expiry because workbox's directoryIndex default rewrites
// GET / to /index.html and serves it from cache, swallowing the
// proxy's 302 to the login page. Navigation requests are handled
// instead by the NavigationRoute below.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// ── Navigation handling ────────────────────────────────────────────────────
//
// NetworkFirst with a short timeout keeps offline launch working
// (returns the last cached navigation response when the network is
// unreachable) without the loop bug that precaching `index.html`
// caused. NetworkFirst follows redirects at the network layer, so an
// Authentik 302 → login HTML is observed as a real HTTP response and
// the SPA's `resilience.ts` auth-expired handling can fire on the
// next API call. Cached entries are capped to keep storage modest.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: cacheName('navigations'),
      networkTimeoutSeconds: 3,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      ],
    }),
  ),
)

// Workbox runtime caching — same buckets the previous generateSW config used,
// now namespaced and build-versioned by `cacheName()`.

const cacheSuccessfulSameOriginAsset = {
  cacheWillUpdate: async ({ response }: { response: Response }) => {
    if (
      response.status !== 200
      || response.redirected
      || new URL(response.url || self.location.href).origin !== self.location.origin
    ) {
      return null
    }
    return response
  },
}

// ── Low-bandwidth mode (PWA-07) ────────────────────────────────────────────
//
// Mirrored from the page's persisted preference via postMessage and restored
// from Cache Storage on worker start-up (a push wakes a FRESH worker with no
// module state). While enabled, bulk media caching is switched off: images and
// map tiles are still SERVED from cache but no longer WRITTEN to it, so a
// metered connection is never spent populating a cache the user did not ask
// for. Text assets (JS/CSS/locales) keep caching — they are what makes the
// next launch cheap, which is the whole point of the mode.
let lowBandwidth = false

/**
 * Reject cache writes for bulk media while low-bandwidth mode is on.
 * Reads are unaffected — an already-cached tile is free to serve.
 */
const skipWritesUnderLowBandwidth = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    lowBandwidth ? null : response,
}

// Vite emits content-hashed route chunks. Cache only chunks the user actually
// visits instead of precaching the entire application during SW installation.
// Redirected responses are rejected so a ForwardAuth login page can never be
// cached under a JavaScript or stylesheet URL.
//
// Locale bundles are separate because visiting many translated pages should
// not evict application, vendor, or route chunks from their cache budget.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin
    && request.destination === 'script'
    && /\/assets\/locale-[^/]+\.js$/i.test(url.pathname),
  new CacheFirst({
    cacheName: cacheName('i18n-locale-assets'),
    plugins: [
      cacheSuccessfulSameOriginAsset,
      new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 90 }),
    ],
  }),
)

registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin
    && (request.destination === 'script' || request.destination === 'style'),
  new CacheFirst({
    cacheName: cacheName('app-route-assets'),
    plugins: [
      cacheSuccessfulSameOriginAsset,
      new ExpirationPlugin({ maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// Keep images used by visited routes available offline without eagerly
// downloading large, route-specific branding and report assets.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin && request.destination === 'image',
  new CacheFirst({
    cacheName: cacheName('app-route-images'),
    plugins: [
      cacheSuccessfulSameOriginAsset,
      skipWritesUnderLowBandwidth,
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// Google Fonts stylesheets
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: cacheName('google-fonts-stylesheets'),
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
)

// Google Fonts webfont files
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: cacheName('google-fonts-webfonts'),
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
)

// Leaflet map tiles — host pattern matches OpenStreetMap, MapBox, etc.
registerRoute(
  ({ url }) => /tile/i.test(url.host) || /\/tiles?\//i.test(url.pathname),
  new CacheFirst({
    cacheName: cacheName('map-tiles'),
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      skipWritesUnderLowBandwidth,
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// ── Authenticated API reads (PWA-02) ───────────────────────────────────────
//
// Handled with a hand-written strategy rather than a Workbox one because the
// disclosure contract needs to rewrite response headers in BOTH directions:
// stamp `x-teslasync-cached-at` on write, and `x-teslasync-cache-source` on
// read. Workbox strategies hand back the stored Response verbatim.
//
// Only the narrow allowlist in `apiCachePolicy.ts` is eligible. Everything
// else — every mutation, every settings/admin/export/auth path, every route
// nobody has explicitly vetted — is not intercepted at all and therefore can
// never be stored.

const API_CACHE = cacheName('api-reads')

function withHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers)
  headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function trimApiCache(cache: Cache): Promise<void> {
  const keys = await cache.keys()
  if (keys.length <= API_CACHE_MAX_ENTRIES) return
  await Promise.all(
    keys
      .slice(0, keys.length - API_CACHE_MAX_ENTRIES)
      .map((key) => cache.delete(key)),
  )
}

async function handleApiRead(event: FetchEvent): Promise<Response> {
  const { request } = event
  const cache = await self.caches.open(API_CACHE)

  try {
    const response = await fetch(request)
    if (isCacheableApiResponse(response)) {
      const stamped = withHeader(
        response.clone(),
        CACHED_AT_HEADER,
        String(Date.now()),
      )
      const write = cache
        .put(request, stamped)
        .then(() => trimApiCache(cache))
        .catch(() => {
          // Storage pressure / quota: caching is an optimisation, the live
          // response above is already on its way to the page.
        })
      event.waitUntil(write)
    } else {
      // A response that became uncacheable (session expired → redirect to the
      // login page, server switched to no-store) must also evict whatever we
      // previously stored, otherwise the stale copy outlives its validity.
      event.waitUntil(cache.delete(request).catch(() => false))
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached == null) throw error

    // A cached read is only an acceptable offline fallback while it is still
    // recent enough that nobody would mistake it for live fleet state. Past
    // `API_CACHE_MAX_AGE_SECONDS` (and for any entry whose capture time is
    // missing or unparseable, which `isCachedEntryExpired` treats as unknown
    // and therefore expired) the entry is deleted and the original network
    // failure is surfaced, so the UI shows its offline/error state instead of
    // a confidently wrong twelve-hour-old battery percentage.
    if (isCachedEntryExpired(readCachedAt(cached), Date.now())) {
      event.waitUntil(cache.delete(request).catch(() => false))
      throw error
    }

    return withHeader(cached, CACHE_SOURCE_HEADER, CACHE_SOURCE_CACHE)
  }
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const requestURL = new URL(event.request.url)
  if (
    event.request.method === 'POST'
    && requestURL.origin === self.location.origin
    && requestURL.pathname === TRIP_SHARE_TARGET_PATH
  ) {
    event.respondWith(
      handleTripShareTargetRequest(
        event.request,
        self.caches,
        self.location.origin,
      ),
    )
    return
  }

  const decision = classifyApiRequest({
    method: event.request.method,
    url: event.request.url,
    origin: self.location.origin,
    hasRangeHeader: event.request.headers.has('range'),
  })
  if (!decision.cacheable) return
  event.respondWith(handleApiRead(event))
})

// ── Device state persistence ───────────────────────────────────────────────
//
// A push wakes a fresh worker: module-level state from the last page visit is
// gone. Both the notification policy and the low-bandwidth flag are therefore
// mirrored into a Cache Storage entry under a synthetic same-origin URL so the
// worker can rehydrate them before the first `push` event is handled.

const DEVICE_STATE_CACHE = cacheName('device-state')
const DEVICE_STATE_URL = '/__teslasync__/device-state'

interface PersistedDeviceState {
  prefs: DeviceNotificationPrefs
  lowBandwidth: boolean
}

let devicePrefs: DeviceNotificationPrefs = sanitizeDeviceNotificationPrefs(
  DEFAULT_DEVICE_NOTIFICATION_PREFS,
)
let deviceStateHydrated = false

async function persistDeviceState(): Promise<void> {
  try {
    const cache = await self.caches.open(DEVICE_STATE_CACHE)
    const body: PersistedDeviceState = { prefs: devicePrefs, lowBandwidth }
    await cache.put(
      DEVICE_STATE_URL,
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
    )
  } catch {
    // Persisting is best-effort. The in-memory copy still governs this
    // worker's lifetime, and the page re-sends prefs on every load.
  }
}

async function hydrateDeviceState(): Promise<void> {
  if (deviceStateHydrated) return
  deviceStateHydrated = true
  try {
    const cache = await self.caches.open(DEVICE_STATE_CACHE)
    const stored = await cache.match(DEVICE_STATE_URL)
    if (stored == null) return
    const parsed = (await stored.json()) as Partial<PersistedDeviceState>
    devicePrefs = sanitizeDeviceNotificationPrefs(parsed?.prefs)
    lowBandwidth = parsed?.lowBandwidth === true
  } catch {
    // Corrupt or unreadable state falls back to the shipped defaults, which
    // deliver everything — failing open is correct for notifications.
  }
}

// ── Web Push ────────────────────────────────────────────────────────────────

interface PushPayload {
  title?: string
  body?: string
  // `icon` is intentionally absent from the wire payload to avoid duplicate
  // notification icons. The interface also omits it so the service worker
  // cannot populate `data.icon` unless the backend webpush.Payload contract is
  // updated first. Per-event contextual icons are future work.
  badge?: string
  tag?: string
  url?: string
  severity?: 'info' | 'warn' | 'critical' | string
  category?: string
  vehicle_id?: number | string
}

self.addEventListener('push', (event: PushEvent) => {
  // Push services occasionally deliver messages with no payload (e.g. a
  // wake-up ping). Surface a generic notification rather than swallowing
  // the event silently — `userVisibleOnly: true` was set at subscribe
  // time, so Chrome will revoke the subscription if we never call
  // showNotification().
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() ?? '' }
  }

  event.waitUntil(
    (async () => {
      await hydrateDeviceState()

      const decision = evaluateNotification(data, devicePrefs, Date.now())
      if (!decision.show) {
        // Muted on THIS device. See sw/notificationPolicy.ts for why only
        // explicit category/severity/vehicle mutes suppress and quiet hours
        // merely silences.
        return
      }

      const title = data.title ?? 'TeslaSync'
      // The drill-through URL is attacker-reachable input (it arrives over the
      // push channel and is handed to WindowClient.navigate on click), so it
      // is validated against an allowlist before it is ever stored on the
      // notification.
      const safeUrl = sanitizeNotificationUrl(data.url, self.location.origin).url

      const options: NotificationOptions = {
        body: data.body ?? '',
        // `icon` is intentionally NOT set. The PWA manifest icon
        // (web/vite.config.ts) already populates the left thumbnail slot of the
        // Android notification card. Setting `icon` here also populates the
        // optional right-hand large-image slot, creating a duplicate icon.
        // Leaving it unset matches common notification styling. Per-event
        // contextual icons are future work.
        //
        // `badge` is the small monochrome status-bar icon on Android. The
        // OS discards colour data and re-tints the alpha channel, so this
        // MUST be a white silhouette on a transparent background.
        // See: https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge
        badge: data.badge ?? '/icons/badge-72.png',
        tag: data.tag,
        data: {
          url: safeUrl,
          category: decision.category,
          severity: decision.severity,
        },
        // Critical alerts persist on screen until tapped; info / warn use
        // the OS default decay. Quiet hours downgrades both.
        requireInteraction: decision.requireInteraction,
        silent: decision.silent,
      }

      await self.registration.showNotification(title, options)
    })(),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  // Re-sanitise on click. The stored value was validated on the push path,
  // but a notification can outlive a service-worker update and this handler
  // must never trust data it did not itself produce in this build.
  const url = sanitizeNotificationUrl(
    event.notification.data?.url,
    self.location.origin,
  ).url

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an existing TeslaSync tab when one is already open.
        for (const client of clientList) {
          if ('focus' in client) {
            // navigate() is widely supported on WindowClient; type guard
            // first so older browsers fall back to a fresh openWindow.
            const w = client as WindowClient
            if (typeof w.navigate === 'function') {
              return w.navigate(url).then(() => w.focus())
            }
            return w.focus()
          }
        }
        return self.clients.openWindow(url || NOTIFICATION_FALLBACK_URL)
      }),
  )
})

// ── Page ↔ worker protocol ──────────────────────────────────────────────────

async function collectStatus(requestId: string): Promise<SwStatusMessage> {
  const entries: CachedApiEntry[] = []
  try {
    const cache = await self.caches.open(API_CACHE)
    for (const request of await cache.keys()) {
      const stored = await cache.match(request)
      const raw = stored?.headers.get(CACHED_AT_HEADER) ?? null
      const parsed = raw == null ? Number.NaN : Number.parseInt(raw, 10)
      entries.push({
        path: new URL(request.url).pathname,
        cachedAt: Number.isFinite(parsed) ? parsed : null,
      })
    }
  } catch {
    // Report an empty list rather than failing the status round-trip; the UI
    // then discloses "no cached data" instead of hanging on a pending promise.
  }
  return {
    type: SW_TO_PAGE.status,
    requestId,
    buildId: BUILD_ID,
    apiContractVersion: API_CONTRACT_VERSION,
    lowBandwidth,
    entries: entries.sort((a, b) => (b.cachedAt ?? 0) - (a.cachedAt ?? 0)),
  }
}

async function purgeApiCache(): Promise<void> {
  try {
    // Sweep the API bucket of EVERY build, not just this one. The caller is
    // either a sign-out (the previous identity's reads must not survive under
    // any build id) or a contract break (where the stale build's bucket is
    // exactly the problem). `staleCacheNames` only runs on activate, so an
    // older bucket can still be on disk at this point.
    const names = await self.caches.keys()
    await Promise.all(
      names
        .filter(isApiReadCacheName)
        .map((name) => self.caches.delete(name).catch(() => false)),
    )
  } catch {
    // Nothing actionable — the next contract check will retry.
  }
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const message = event.data
  if (!isPageToSwMessage(message)) return

  switch (message.type) {
    case PAGE_TO_SW.skipWaiting:
      // Only ever reached because a page explicitly asked (see
      // hooks/usePwaUpdate.ts). Never called from `install`.
      self.skipWaiting()
      return
    case PAGE_TO_SW.deviceNotificationPrefs:
      deviceStateHydrated = true
      devicePrefs = sanitizeDeviceNotificationPrefs(message.prefs)
      event.waitUntil(persistDeviceState())
      return
    case PAGE_TO_SW.lowBandwidth:
      deviceStateHydrated = true
      lowBandwidth = message.enabled
      event.waitUntil(persistDeviceState())
      return
    case PAGE_TO_SW.purgeApiCache:
      event.waitUntil(purgeApiCache())
      return
    case PAGE_TO_SW.requestStatus: {
      const port = event.ports?.[0]
      const requestId = message.requestId
      event.waitUntil(
        collectStatus(requestId).then((status) => {
          if (port != null) {
            port.postMessage(status)
            return
          }
          const source = event.source as Client | null
          source?.postMessage(status)
        }),
      )
      return
    }
    default: {
      // Exhaustiveness guard: adding a PageToSwMessage variant without a case
      // above becomes a compile error here.
      const unhandled: never = message
      void unhandled
    }
  }
})

export {}
