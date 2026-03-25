/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

// Precache app shell — Workbox replaces this with the build manifest.
// Content-hash-based keys guarantee no stale JS (the root cause of
// the v0.18.9 incident).
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// App shell: serve index.html for all navigation requests (SPA)
const handler = createHandlerBoundToURL('/index.html')
const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//, /^\/healthz/, /^\/readyz/],
})
registerRoute(navigationRoute)

// API requests: NetworkFirst with 10s timeout, fallback to cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/') && !url.pathname.includes('/events'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  })
)

// Google Fonts stylesheets
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' })
)

// Google Fonts webfont files
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  })
)

// Leaflet map tiles
registerRoute(
  ({ url }) => url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('tiles'),
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  })
)

// Leaflet CSS/JS from unpkg
registerRoute(
  ({ url }) => url.origin === 'https://unpkg.com',
  new CacheFirst({
    cacheName: 'cdn-assets',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
)

// Offline fallback via Workbox catch handler (no raw fetch listener conflict)
setCatchHandler(async ({ event }) => {
  if ((event as FetchEvent).request.destination === 'document') {
    const cache = await caches.open('offline-fallback')
    return (await cache.match('/offline.html')) || Response.error()
  }
  return Response.error()
})

// Cache offline page on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('offline-fallback').then((cache) => cache.add('/offline.html'))
  )
})

// === Push Notifications (Tier 2) ===
self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  const title = data.title || 'TeslaSync'
  const options: NotificationOptions = {
    body: data.body || '',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: data.tag || 'teslasync-notification',
    data: { url: data.url || '/' },
    actions: data.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    vibrate: [100, 50, 100],
    renotify: !!data.tag,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})

// === Background Sync (Tier 2) ===
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-export-jobs') {
    event.waitUntil(syncExportJobs())
  }
  if (event.tag === 'sync-commands') {
    event.waitUntil(syncQueuedCommands())
  }
})

async function syncExportJobs(): Promise<void> {
  const db = await openSyncDB()
  const tx = db.transaction('sync-queue', 'readwrite')
  const store = tx.objectStore('sync-queue')
  const items = await getAllFromStore(store)

  for (const item of items) {
    if (item.type !== 'export') continue
    try {
      await fetch('/api/v1/export/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload),
      })
      store.delete(item.id)
    } catch {
      // Will retry on next sync
    }
  }
}

async function syncQueuedCommands(): Promise<void> {
  const db = await openSyncDB()
  const tx = db.transaction('sync-queue', 'readwrite')
  const store = tx.objectStore('sync-queue')
  const items = await getAllFromStore(store)

  for (const item of items) {
    if (item.type !== 'command') continue
    // Skip stale commands (>5 minutes old)
    if (Date.now() - item.timestamp > 5 * 60 * 1000) {
      store.delete(item.id)
      continue
    }
    try {
      await fetch(`/api/v1/vehicles/${item.vehicleId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: item.command, params: item.params }),
      })
      store.delete(item.id)
    } catch {
      // Will retry on next sync
    }
  }
}

function openSyncDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('teslasync-sync', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('sync-queue')) {
        db.createObjectStore('sync-queue', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Wrapper: IDBObjectStore.getAll() returns IDBRequest, wrap as Promise
function getAllFromStore(store: IDBObjectStore): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// === Periodic Background Sync (Tier 2) ===
self.addEventListener('periodicsync', ((event: any) => {
  if (event.tag === 'refresh-dashboard') {
    event.waitUntil(refreshDashboardData())
  }
}) as EventListener)

async function refreshDashboardData(): Promise<void> {
  const cache = await caches.open('api-cache')
  const endpoints = ['/api/v1/vehicles', '/api/v1/alerts?limit=20']
  await Promise.allSettled(
    endpoints.map(async (url) => {
      const response = await fetch(url)
      if (response.ok) await cache.put(url, response)
    })
  )
}

// Activate immediately and claim all clients
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Listen for skip-waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
