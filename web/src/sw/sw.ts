/// <reference lib="webworker" />
//
// TeslaSync custom service worker.
//
// vite-plugin-pwa is configured with strategies: 'injectManifest' so this
// file is bundled by the plugin and registered as the production SW.
// We keep the same precache + runtime caching behaviour the project had
// under generateSW, and add a `push` event handler so OS-level
// notifications fire even when the TeslaSync tab is closed.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// ── SW lifecycle: skipWaiting + clientsClaim ───────────────────────────────
//
// vite-plugin-pwa `registerType: 'autoUpdate'` reloads controlled pages
// when the new SW reaches the `activated` state. For that handoff to
// happen, the new SW must skip `waiting` and take control of existing
// clients. In `generateSW` mode the plugin auto-injects these via the
// workbox config; in `injectManifest` mode the plugin can NOT modify
// this hand-written file, so the install/activate handlers must be
// declared explicitly. Without them, the new SW sits in `waiting`
// indefinitely on tabs the user keeps open — autoUpdate becomes a
// silent no-op for installed PWAs. The existing message-based
// SKIP_WAITING handler at the bottom is kept for legacy compat.
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
      cacheName: 'navigations',
      networkTimeoutSeconds: 3,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 }),
      ],
    }),
  ),
)

// Workbox runtime caching — same three buckets the previous generateSW
// config used. Re-implementing them here keeps SPA performance unchanged
// after the strategy switch.

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
    cacheName: 'i18n-locale-assets',
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
    cacheName: 'app-route-assets',
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
    cacheName: 'app-route-images',
    plugins: [
      cacheSuccessfulSameOriginAsset,
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

// Google Fonts stylesheets
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-stylesheets',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
)

// Google Fonts webfont files
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
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
    cacheName: 'map-tiles',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

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

  const title = data.title ?? 'TeslaSync'
  const options: NotificationOptions = {
    body: data.body ?? '',
    // `icon` is intentionally NOT set. The PWA manifest icon
    // (web/vite.config.ts) already populates the left thumbnail slot of the
    // Android notification card. Setting `icon` here also populates the
    // optional right-hand large-image slot, creating a duplicate icon. Leaving
    // it unset matches common notification styling. Per-event contextual icons
    // are future work.
    //
    // `badge` is the small monochrome status-bar icon on Android. The
    // OS discards colour data and re-tints the alpha channel, so this
    // MUST be a white silhouette on a transparent background.
    // See: https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge
    badge: data.badge ?? '/icons/badge-72.png',
    tag: data.tag,
    data: { url: data.url ?? '/notifications/inbox' },
    // Critical alerts persist on screen until tapped; info / warn use
    // the OS default decay.
    requireInteraction: data.severity === 'critical',
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()

  const url = (event.notification.data?.url as string | undefined) ?? '/'

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
        return self.clients.openWindow(url)
      }),
  )
})

// SKIP_WAITING handler — vite-plugin-pwa uses postMessage to drive the
// "Update available — reload" prompt registered by useRegisterSW().
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
