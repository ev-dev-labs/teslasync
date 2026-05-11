/// <reference lib="webworker" />
//
// TeslaSync custom service worker (Phase 40 / Prompt 52).
//
// vite-plugin-pwa is configured with strategies: 'injectManifest' so this
// file is bundled by the plugin and registered as the production SW.
// We keep the same precache + runtime caching behaviour the project had
// under generateSW, and add a `push` event handler so OS-level
// notifications fire even when the TeslaSync tab is closed.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// Precache the build manifest. injectManifest substitutes
// `self.__WB_MANIFEST` with the list of build artefacts at build time.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Workbox runtime caching — same three buckets the previous generateSW
// config used. Re-implementing them here keeps SPA performance unchanged
// after the strategy switch.

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
  // Phase-49 / Slice 0010 — `icon` was removed from the wire payload
  // (the duplicate-icon bug). The interface intentionally drops it too
  // so a future contributor cannot start populating `data.icon` from
  // the SW side without first re-introducing the contract on the
  // backend's webpush.Payload struct (which has its own regression
  // test pinning the absence). Per-event contextual icons are tracked
  // as future work; see prompt 0010 for the rationale.
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
    // Phase-49 / Slice 0010 — `icon` is intentionally NOT set. The PWA
    // manifest icon (web/vite.config.ts) already populates the left
    // thumbnail slot of the Android notification card. Setting `icon`
    // here populates the OPTIONAL right-hand large-image slot too,
    // which on Android Chrome renders the SAME teal lightning bolt as
    // the manifest icon and produces the user-reported "duplicate
    // icon" appearance. Leaving it unset matches the Macy's / Yahoo
    // notification style (icon on left only). Per-event contextual
    // icons are tracked as future work; see prompt 0010.
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
