// TeslaSync Service Worker — Production PWA
// Strategy: Cache-first for assets, network-first for API, stale-while-revalidate for tiles

const CACHE_VERSION = 'teslasync-v1'
const STATIC_CACHE = CACHE_VERSION + '-static'
const TILE_CACHE = CACHE_VERSION + '-tiles'

// Assets to precache on install
const PRECACHE = ['/', '/index.html', '/favicon.svg', '/icons/icon-192.svg', '/icons/icon-512.svg']

// Install: precache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

// Activate: clean old versioned caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('teslasync-') && k !== STATIC_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// Fetch: route-based caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Only handle http/https — skip chrome-extension, data, etc.
  if (!url.protocol.startsWith('http')) return

  // Skip cross-origin auth/OAuth redirects
  if (url.origin !== self.location.origin && !url.hostname.includes('basemaps.cartocdn.com') &&
      !url.hostname.includes('tile.openstreetmap.org') && !url.hostname.includes('arcgisonline.com') &&
      !url.hostname.includes('opentopomap.org') && !url.hostname.includes('atlas.microsoft.com') &&
      !url.hostname.includes('google.com')) return

  // API calls: network-first (always fresh vehicle data)
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/readyz') {
    event.respondWith(networkFirst(event.request))
    return
  }

  // Map tiles: stale-while-revalidate (show cached, update in background)
  if (url.hostname.includes('basemaps.cartocdn.com') ||
      url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('arcgisonline.com') ||
      url.hostname.includes('opentopomap.org') ||
      url.hostname.includes('atlas.microsoft.com') ||
      url.hostname.includes('google.com/vt')) {
    event.respondWith(staleWhileRevalidate(event.request, TILE_CACHE))
    return
  }

  // Static assets (JS/CSS/fonts/images): cache-first
  if (event.request.destination === 'script' ||
      event.request.destination === 'style' ||
      event.request.destination === 'font' ||
      event.request.destination === 'image' ||
      url.pathname.match(/\.(js|css|woff2?|ttf|svg|png|jpg|ico)$/)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE))
    return
  }

  // HTML navigation: network-first (SPA routing)
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request))
    return
  }

  // Default: network
  event.respondWith(fetch(event.request))
})

// Cache-first: return cached if available, else fetch and cache
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// Network-first: try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Stale-while-revalidate: return cached immediately, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone())
    return response
  }).catch(() => cached)
  return cached || fetchPromise
}
