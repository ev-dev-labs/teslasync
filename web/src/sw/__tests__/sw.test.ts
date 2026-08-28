/**
 * Service-worker integration contract.
 *
 * `sw.ts` registers listeners on `self` at import time. In jsdom `self` is
 * `window`, so the tests below import the worker once per case (with a fresh
 * module registry), then dispatch synthetic `activate` / `fetch` / `push` /
 * `notificationclick` / `message` events and assert the observable effects on
 * the mocked Cache Storage, `fetch`, and `registration` surfaces.
 *
 * Workbox is mocked because `precacheAndRoute` and friends throw outside a
 * real ServiceWorkerGlobalScope. The routing table it receives is inspected
 * directly, which is also how the runtime-caching assertions work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  API_CACHE_BUCKET_PREFIX,
  BUILD_ID,
  CACHE_PREFIX,
  cacheName,
  currentCacheNames,
} from '../buildContract'
import {
  API_CACHE_MAX_AGE_SECONDS,
  CACHED_AT_HEADER,
  CACHE_SOURCE_HEADER,
} from '../apiCachePolicy'
import { PAGE_TO_SW, SW_TO_PAGE } from '../swProtocol'
import { DEFAULT_DEVICE_NOTIFICATION_PREFS } from '../notificationPolicy'

vi.mock('workbox-precaching', () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
}))

vi.mock('workbox-routing', () => ({
  registerRoute: vi.fn(),
  NavigationRoute: vi.fn().mockImplementation(function () {
    return {}
  }),
}))

vi.mock('workbox-strategies', () => ({
  CacheFirst: vi.fn().mockImplementation(function (options: unknown) {
    return { kind: 'CacheFirst', options }
  }),
  NetworkFirst: vi.fn().mockImplementation(function (options: unknown) {
    return { kind: 'NetworkFirst', options }
  }),
}))

vi.mock('workbox-expiration', () => ({
  ExpirationPlugin: vi.fn().mockImplementation(function () {
    return {}
  }),
}))

vi.mock('workbox-cacheable-response', () => ({
  CacheableResponsePlugin: vi.fn().mockImplementation(function () {
    return {}
  }),
}))

// ── Fake Cache Storage ──────────────────────────────────────────────────────

class FakeCache {
  entries = new Map<string, Response>()

  async put(request: RequestInfo, response: Response) {
    this.entries.set(keyOf(request), response)
  }

  async match(request: RequestInfo) {
    return this.entries.get(keyOf(request)) ?? undefined
  }

  async delete(request: RequestInfo) {
    return this.entries.delete(keyOf(request))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

function keyOf(request: RequestInfo): string {
  return typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>()

  async open(name: string) {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new FakeCache()
      this.caches.set(name, cache)
    }
    return cache as unknown as Cache
  }

  async keys() {
    return [...this.caches.keys()]
  }

  async delete(name: string) {
    return this.caches.delete(name)
  }
}

const ORIGIN = window.location.origin

// ── Harness ─────────────────────────────────────────────────────────────────

const showNotification = vi.fn(async () => {})
const openWindow = vi.fn(async () => null)
const navigateSpy = vi.fn(async () => null)
const focusSpy = vi.fn(async () => null)
const skipWaiting = vi.fn()
const clientsClaim = vi.fn(async () => {})

let cacheStorage: FakeCacheStorage
let fetchMock: ReturnType<typeof vi.fn>
let windowClients: unknown[]

const globalSelf = globalThis as Record<string, unknown>

/**
 * jsdom's `window` (which stands in for `self`) lives for the whole test FILE,
 * so re-importing the worker with a fresh module registry would stack a second
 * copy of every listener on top of the first. Each dispatch would then run the
 * handler twice — doubling `showNotification` calls and, worse, creating a
 * second unhandled `respondWith` promise. Record what each import registers so
 * `afterEach` can detach it.
 */
let registered: Array<[string, EventListenerOrEventListenerObject]> = []

async function importWorker() {
  const original = window.addEventListener.bind(window)
  const spy = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation((type: string, listener: never, options: never) => {
      registered.push([type, listener])
      return original(type, listener, options)
    })
  try {
    await import('../sw')
  } finally {
    spy.mockRestore()
  }
}

function detachWorker() {
  for (const [type, listener] of registered) {
    window.removeEventListener(type, listener)
  }
  registered = []
}

beforeEach(async () => {
  // The workbox mocks are module-level `vi.fn()`s created by the `vi.mock`
  // factories. `vi.resetModules()` does NOT reset their call history, so
  // without this every re-import stacks another set of `registerRoute` calls
  // and any count-based assertion drifts upward through the file.
  vi.clearAllMocks()

  cacheStorage = new FakeCacheStorage()
  windowClients = []
  showNotification.mockClear()
  openWindow.mockClear()
  navigateSpy.mockClear()
  focusSpy.mockClear()
  skipWaiting.mockClear()
  clientsClaim.mockClear()

  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

  Object.assign(globalSelf, {
    __WB_MANIFEST: [],
    registration: { showNotification },
    skipWaiting,
    caches: cacheStorage,
    fetch: fetchMock,
    clients: {
      claim: clientsClaim,
      matchAll: vi.fn(async () => windowClients),
      openWindow,
    },
  })

  vi.resetModules()
  await importWorker()
})

afterEach(() => {
  detachWorker()
  vi.restoreAllMocks()
})

interface Extendable {
  waitUntil: (p: Promise<unknown>) => void
}

function makeExtendable<T extends Event>(event: T): T & Extendable & { settle: () => Promise<unknown> } {
  const pending: Promise<unknown>[] = []
  const decorated = event as T & Extendable & { settle: () => Promise<unknown> }
  decorated.waitUntil = (p) => {
    pending.push(p)
  }
  decorated.settle = () => Promise.all(pending)
  return decorated
}

async function dispatchActivate() {
  const event = makeExtendable(new Event('activate'))
  window.dispatchEvent(event)
  await event.settle()
}

async function dispatchPush(payload: Record<string, unknown> | null) {
  const event = makeExtendable(new Event('push')) as Event &
    Extendable & { settle: () => Promise<unknown>; data?: unknown }
  if (payload != null) {
    event.data = {
      json: () => payload,
      text: () => JSON.stringify(payload),
    }
  }
  window.dispatchEvent(event)
  await event.settle()
}

async function dispatchNotificationClick(data: unknown) {
  const close = vi.fn()
  const event = makeExtendable(new Event('notificationclick')) as Event &
    Extendable & { settle: () => Promise<unknown>; notification?: unknown }
  event.notification = { close, data }
  window.dispatchEvent(event)
  await event.settle()
  return { close }
}

async function dispatchMessage(
  data: unknown,
  extra: { ports?: unknown[]; source?: unknown } = {},
) {
  const event = makeExtendable(new Event('message')) as Event &
    Extendable & {
      settle: () => Promise<unknown>
      data?: unknown
      ports?: unknown[]
      source?: unknown
    }
  event.data = data
  event.ports = extra.ports ?? []
  event.source = extra.source
  window.dispatchEvent(event)
  await event.settle()
}

async function dispatchFetch(request: Request) {
  const event = makeExtendable(new Event('fetch')) as Event &
    Extendable & {
      settle: () => Promise<unknown>
      request: Request
      respondWith: (r: Promise<Response> | Response) => void
    }
  event.request = request
  let responded: Promise<Response> | Response | undefined
  event.respondWith = (r) => {
    responded = r
  }
  window.dispatchEvent(event)
  const response = responded == null ? null : await responded
  await event.settle()
  return response
}

// ── Lifecycle (PWA-03 / PWA-04) ─────────────────────────────────────────────

describe('service worker lifecycle', () => {
  it('never calls skipWaiting on its own — no forced auto-update', async () => {
    const install = makeExtendable(new Event('install'))
    window.dispatchEvent(install)
    await install.settle()
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('skips waiting only when a page explicitly asks', async () => {
    await dispatchMessage({ type: PAGE_TO_SW.skipWaiting })
    expect(skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('claims clients and deletes every stale TeslaSync cache on activate', async () => {
    const stale = `${CACHE_PREFIX}-app-route-assets-0.0.1+oldbuil`
    const foreign = 'some-other-app-v1'
    await cacheStorage.open(stale)
    await cacheStorage.open(foreign)
    for (const name of currentCacheNames()) await cacheStorage.open(name)

    await dispatchActivate()

    expect(clientsClaim).toHaveBeenCalled()
    const remaining = await cacheStorage.keys()
    expect(remaining).not.toContain(stale)
    expect(remaining).toContain(foreign)
    expect(remaining).toContain(cacheName('app-route-assets'))
  })
})

// ── Runtime caching (PWA-02 / PWA-04 / PWA-07) ──────────────────────────────

describe('runtime caching registration', () => {
  async function routes() {
    const { registerRoute } = await import('workbox-routing')
    return vi.mocked(registerRoute).mock.calls as unknown as Array<
      [
        unknown,
        {
          options?: {
            cacheName?: string
            plugins?: Array<{
              cacheWillUpdate?: (c: { response: Response }) => Promise<Response | null>
            }>
          }
        },
      ]
    >
  }

  it('versions every app-owned bucket with the build id', async () => {
    const names = (await routes()).map(([, strategy]) => strategy?.options?.cacheName)
    expect(names).toContain(cacheName('app-route-assets'))
    expect(names).toContain(cacheName('i18n-locale-assets'))
    expect(names.some((n) => n?.includes(BUILD_ID))).toBe(true)
    // Third-party buckets stay unversioned.
    expect(names).toContain(cacheName('map-tiles'))
    expect(cacheName('map-tiles')).not.toContain(BUILD_ID)
  })

  it('registers the locale cache before the general asset cache', async () => {
    const names = (await routes()).map(([, s]) => s?.options?.cacheName)
    expect(names.indexOf(cacheName('i18n-locale-assets'))).toBeLessThan(
      names.indexOf(cacheName('app-route-assets')),
    )
  })

  it('runtime-caches only same-origin scripts and styles', async () => {
    const entry = (await routes()).find(
      ([, s]) => s?.options?.cacheName === cacheName('app-route-assets'),
    )
    const matcher = entry?.[0] as (c: {
      request: Pick<Request, 'destination'>
      url: URL
    }) => boolean

    expect(matcher({ request: { destination: 'script' }, url: new URL('/assets/x.js', ORIGIN) })).toBe(true)
    expect(matcher({ request: { destination: 'style' }, url: new URL('/assets/x.css', ORIGIN) })).toBe(true)
    expect(matcher({ request: { destination: 'image' }, url: new URL('/assets/x.png', ORIGIN) })).toBe(false)
    expect(matcher({ request: { destination: 'script' }, url: new URL('https://cdn.example.com/x.js') })).toBe(false)
  })

  it('refuses to cache redirected ForwardAuth responses as route assets', async () => {
    const strategy = (await routes()).find(
      ([, s]) => s?.options?.cacheName === cacheName('app-route-assets'),
    )?.[1]
    const guard = strategy?.options?.plugins?.find((p) => p.cacheWillUpdate)

    const valid = { status: 200, redirected: false, url: `${ORIGIN}/assets/chunk.js` } as Response
    const redirected = { status: 200, redirected: true, url: `${ORIGIN}/auth/login` } as Response

    await expect(guard?.cacheWillUpdate?.({ response: valid })).resolves.toBe(valid)
    await expect(guard?.cacheWillUpdate?.({ response: redirected })).resolves.toBeNull()
  })

  it('stops writing map tiles and images once low-bandwidth mode is on', async () => {
    const all = await routes()
    const tileGuards = all
      .filter(([, s]) =>
        s?.options?.cacheName === cacheName('map-tiles')
        || s?.options?.cacheName === cacheName('app-route-images'))
      .map(([, s]) => s?.options?.plugins ?? [])

    expect(tileGuards).toHaveLength(2)
    const tile = { status: 200, redirected: false, url: 'https://tile.example/1.png' } as Response

    // Default: writes allowed (the image bucket also runs the same-origin
    // guard, so only the tile bucket is asserted for the pass-through).
    const tilePlugins = all.find(
      ([, s]) => s?.options?.cacheName === cacheName('map-tiles'),
    )?.[1].options?.plugins ?? []
    const before = await Promise.all(
      tilePlugins
        .filter((p) => p.cacheWillUpdate)
        .map((p) => p.cacheWillUpdate!({ response: tile })),
    )
    expect(before.every((r) => r === tile)).toBe(true)

    await dispatchMessage({ type: PAGE_TO_SW.lowBandwidth, enabled: true })

    const after = await Promise.all(
      tilePlugins
        .filter((p) => p.cacheWillUpdate)
        .map((p) => p.cacheWillUpdate!({ response: tile })),
    )
    expect(after).toContain(null)
  })
})

// ── API read cache (PWA-02) ─────────────────────────────────────────────────

describe('authenticated API read caching', () => {
  const apiCache = () => cacheStorage.caches.get(cacheName('api-reads'))

  it('caches an allowlisted GET and stamps it with the capture time', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
    )
    const response = await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    expect(response?.status).toBe(200)
    const stored = await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)
    expect(stored).toBeDefined()
    expect(Number(stored?.headers.get(CACHED_AT_HEADER))).toBeGreaterThan(0)
  })

  it('does not intercept a mutation at all', async () => {
    const response = await dispatchFetch(
      new Request(`${ORIGIN}/api/v1/vehicles`, { method: 'POST' }),
    )
    expect(response).toBeNull()
    expect(apiCache()).toBeUndefined()
  })

  it('does not intercept a sensitive read', async () => {
    const response = await dispatchFetch(new Request(`${ORIGIN}/api/v1/settings`))
    expect(response).toBeNull()
  })

  it('never stores a ForwardAuth redirect, and evicts a previously stored copy', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))
    expect(await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)).toBeDefined()

    const redirect = new Response('<html>login</html>', { status: 200 })
    Object.defineProperty(redirect, 'redirected', { value: true })
    fetchMock.mockResolvedValueOnce(redirect)
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    expect(await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)).toBeUndefined()
  })

  it('serves the cached copy offline and labels it as coming from cache', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    expect(offline?.headers.get(CACHE_SOURCE_HEADER)).toBe('cache')
    expect(Number(offline?.headers.get(CACHED_AT_HEADER))).toBeGreaterThan(0)
  })

  it('propagates the network error when nothing is cached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(dispatchFetch(new Request(`${ORIGIN}/api/v1/drives`))).rejects.toThrow()
  })

  // ── Max-age enforcement on the offline fallback ───────────────────────────
  //
  // A cached read is only an honest fallback while it is recent. These cases
  // pin `API_CACHE_MAX_AGE_SECONDS` / `readCachedAt` / `isCachedEntryExpired`
  // being wired into the catch branch, so a twelve-hour-old state of charge
  // can never be presented as the current one.

  /** Seed the API cache directly with a chosen capture stamp. */
  async function seedCachedRead(path: string, cachedAt: number | null) {
    const cache = await cacheStorage.open(cacheName('api-reads'))
    const headers = new Headers({ 'content-type': 'application/json' })
    if (cachedAt != null) headers.set(CACHED_AT_HEADER, String(cachedAt))
    await cache.put(
      new Request(`${ORIGIN}${path}`),
      new Response('[{"id":1}]', { status: 200, headers }),
    )
  }

  it('serves a cached entry that is still just inside the max-age window', async () => {
    // 5 s inside the boundary rather than exactly on it: the worker reads its
    // own `Date.now()` a few milliseconds after the test computes the stamp,
    // and `isCachedEntryExpired` is a strict `>` comparison. Exact-boundary
    // semantics are pinned by the pure test in `apiCachePolicy.test.ts`.
    const now = Date.now()
    await seedCachedRead(
      '/api/v1/vehicles',
      now - API_CACHE_MAX_AGE_SECONDS * 1000 + 5_000,
    )

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    expect(offline?.headers.get(CACHE_SOURCE_HEADER)).toBe('cache')
    expect(await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)).toBeDefined()
  })

  it('refuses an expired entry, deletes it, and surfaces the network failure', async () => {
    const now = Date.now()
    await seedCachedRead(
      '/api/v1/vehicles',
      now - API_CACHE_MAX_AGE_SECONDS * 1000 - 1_000,
    )

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`)),
    ).rejects.toThrow()

    // Deleted, so a later request cannot resurrect it either.
    expect(await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)).toBeUndefined()
  })

  it('treats a cached entry with no capture stamp as expired', async () => {
    // An unstamped entry cannot be disclosed honestly, so it is discarded
    // rather than shown as "cached at an unknown time".
    await seedCachedRead('/api/v1/drives', null)

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      dispatchFetch(new Request(`${ORIGIN}/api/v1/drives`)),
    ).rejects.toThrow()
    expect(await apiCache()?.match(`${ORIGIN}/api/v1/drives`)).toBeUndefined()
  })

  it('treats a cached entry with a corrupt capture stamp as expired', async () => {
    const cache = await cacheStorage.open(cacheName('api-reads'))
    await cache.put(
      new Request(`${ORIGIN}/api/v1/charging`),
      new Response('[]', {
        status: 200,
        headers: { [CACHED_AT_HEADER]: 'not-a-number' },
      }),
    )

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      dispatchFetch(new Request(`${ORIGIN}/api/v1/charging`)),
    ).rejects.toThrow()
    expect(await apiCache()?.match(`${ORIGIN}/api/v1/charging`)).toBeUndefined()
  })

  it('a fresh network response re-stamps an entry that had aged out', async () => {
    await seedCachedRead(
      '/api/v1/vehicles',
      Date.now() - API_CACHE_MAX_AGE_SECONDS * 1000 - 60_000,
    )

    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    const stored = await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)
    const stamp = Number(stored?.headers.get(CACHED_AT_HEADER))
    expect(stamp).toBeGreaterThan(Date.now() - API_CACHE_MAX_AGE_SECONDS * 1000)
  })

  // ── Sensitive-cache regression guard ──────────────────────────────────────

  it.each([
    '/api/v1/settings',
    '/api/v1/settings/backup',
    '/api/v1/admin/audit-log',
    '/api/v1/push/public-key',
    '/api/v1/push/subscribe',
    '/api/v1/exports',
    '/api/v1/account/sessions',
    '/api/v1/sharing/links',
    '/api/v1/auth/session',
    '/api/v1/totp/setup',
  ])('never creates a cache entry for the sensitive read %s', async (path) => {
    fetchMock.mockResolvedValueOnce(new Response('{"secret":"x"}', { status: 200 }))
    const response = await dispatchFetch(new Request(`${ORIGIN}${path}`))

    // Not intercepted at all — the browser handles it, so nothing is stored.
    expect(response).toBeNull()
    expect(await apiCache()?.match(`${ORIGIN}${path}`)).toBeUndefined()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'never creates a cache entry for a %s mutation of an allowlisted path',
    async (method) => {
      const response = await dispatchFetch(
        new Request(`${ORIGIN}/api/v1/vehicles`, { method }),
      )
      expect(response).toBeNull()
      expect(await apiCache()?.match(`${ORIGIN}/api/v1/vehicles`)).toBeUndefined()
    },
  )
})

// ── Web Push (PWA-05 / PWA-06) ──────────────────────────────────────────────

describe('push handling', () => {
  it('does not populate NotificationOptions.icon', async () => {
    await dispatchPush({ title: 'Drive Started', body: 'Roadster is moving', tag: 'drive-42' })
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(showNotification.mock.calls[0][1].icon).toBeUndefined()
  })

  it('sets the monochrome badge and makes critical alerts sticky', async () => {
    await dispatchPush({ title: 'Critical', severity: 'critical' })
    const options = showNotification.mock.calls[0][1]
    expect(options.badge).toBe('/icons/badge-72.png')
    expect(options.requireInteraction).toBe(true)
  })

  it('ignores a stray `icon` key smuggled in by an older backend', async () => {
    await dispatchPush({ title: 'Stale schema', icon: '/icons/icon-192.png' })
    expect(showNotification.mock.calls[0][1].icon).toBeUndefined()
  })

  it('still notifies on a payload-less wake-up ping', async () => {
    await dispatchPush(null)
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(showNotification.mock.calls[0][0]).toBe('TeslaSync')
  })

  it('sanitises a hostile deep link before storing it on the notification', async () => {
    await dispatchPush({ title: 'Phish', url: 'https://evil.example/harvest' })
    expect(showNotification.mock.calls[0][1].data.url).toBe('/notifications/inbox')
  })

  it('preserves a legitimate deep link', async () => {
    await dispatchPush({ title: 'Drive', url: '/drives/42?vehicle_id=3' })
    expect(showNotification.mock.calls[0][1].data.url).toBe('/drives/42?vehicle_id=3')
  })

  it('applies the device policy pushed from the page', async () => {
    await dispatchMessage({
      type: PAGE_TO_SW.deviceNotificationPrefs,
      prefs: { ...DEFAULT_DEVICE_NOTIFICATION_PREFS, minSeverity: 'critical' },
    })

    await dispatchPush({ title: 'Chatty', severity: 'info' })
    expect(showNotification).not.toHaveBeenCalled()

    await dispatchPush({ title: 'Important', severity: 'critical' })
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('rehydrates the device policy from Cache Storage after a cold worker start', async () => {
    // Simulate a push waking a brand-new worker that never saw a page.
    const cache = await cacheStorage.open(cacheName('device-state'))
    await cache.put(
      new Request(`${ORIGIN}/__teslasync__/device-state`),
      new Response(
        JSON.stringify({
          prefs: { ...DEFAULT_DEVICE_NOTIFICATION_PREFS, enabled: false },
          lowBandwidth: true,
        }),
      ),
    )

    vi.resetModules()
    detachWorker()
    await importWorker()

    await dispatchPush({ title: 'Muted device', severity: 'critical' })
    expect(showNotification).not.toHaveBeenCalled()
  })
})

describe('notificationclick', () => {
  it('re-sanitises the stored URL before navigating', async () => {
    await dispatchNotificationClick({ url: 'https://evil.example/x' })
    expect(openWindow).toHaveBeenCalledWith('/notifications/inbox')
  })

  it('reuses an existing window when one is open', async () => {
    windowClients = [{ focus: focusSpy, navigate: navigateSpy }]
    const { close } = await dispatchNotificationClick({ url: '/vehicles/9' })

    expect(close).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/vehicles/9')
    expect(focusSpy).toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})

// ── Page protocol ───────────────────────────────────────────────────────────

describe('page ↔ worker protocol', () => {
  it('ignores foreign postMessage traffic', async () => {
    await dispatchMessage({ type: 'some-analytics-sdk/ping' })
    await dispatchMessage('not-an-object')
    await dispatchMessage(null)
    expect(skipWaiting).not.toHaveBeenCalled()
  })

  it('answers a status request over the supplied MessagePort', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    const postMessage = vi.fn()
    await dispatchMessage(
      { type: PAGE_TO_SW.requestStatus, requestId: 'req-1' },
      { ports: [{ postMessage, close: vi.fn() }] },
    )

    expect(postMessage).toHaveBeenCalledTimes(1)
    const status = postMessage.mock.calls[0][0]
    expect(status).toMatchObject({
      type: SW_TO_PAGE.status,
      requestId: 'req-1',
      buildId: BUILD_ID,
    })
    expect(status.entries[0]).toMatchObject({ path: '/api/v1/vehicles' })
    expect(status.entries[0].cachedAt).toBeGreaterThan(0)
  })

  it('falls back to the message source when no port is supplied', async () => {
    const postMessage = vi.fn()
    await dispatchMessage(
      { type: PAGE_TO_SW.requestStatus, requestId: 'req-2' },
      { source: { postMessage } },
    )
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('purges every cached API read on request', async () => {
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))
    expect(cacheStorage.caches.has(cacheName('api-reads'))).toBe(true)

    await dispatchMessage({ type: PAGE_TO_SW.purgeApiCache })
    expect(cacheStorage.caches.has(cacheName('api-reads'))).toBe(false)
  })

  it('purges the API bucket of EVERY build id, not just the current one', async () => {
    // On an identity transition a previous deploy's bucket holds exactly the
    // same authenticated data, and `staleCacheNames` only runs on activate —
    // so it can still be on disk when the user signs out.
    const previousBuild = `${API_CACHE_BUCKET_PREFIX}-1.0.0+oldbuil`
    await cacheStorage.open(previousBuild)
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await dispatchFetch(new Request(`${ORIGIN}/api/v1/vehicles`))

    await dispatchMessage({ type: PAGE_TO_SW.purgeApiCache })

    expect(cacheStorage.caches.has(previousBuild)).toBe(false)
    expect(cacheStorage.caches.has(cacheName('api-reads'))).toBe(false)
  })

  it('leaves non-API caches untouched when purging', async () => {
    for (const name of [
      cacheName('app-route-assets'),
      cacheName('i18n-locale-assets'),
      cacheName('map-tiles'),
      cacheName('device-state'),
      'workbox-precache-v2',
    ]) {
      await cacheStorage.open(name)
    }

    await dispatchMessage({ type: PAGE_TO_SW.purgeApiCache })

    expect(cacheStorage.caches.has(cacheName('app-route-assets'))).toBe(true)
    expect(cacheStorage.caches.has(cacheName('i18n-locale-assets'))).toBe(true)
    expect(cacheStorage.caches.has(cacheName('map-tiles'))).toBe(true)
    expect(cacheStorage.caches.has(cacheName('device-state'))).toBe(true)
    expect(cacheStorage.caches.has('workbox-precache-v2')).toBe(true)
  })

  it('persists device state so a restarted worker inherits it', async () => {
    await dispatchMessage({
      type: PAGE_TO_SW.deviceNotificationPrefs,
      prefs: { ...DEFAULT_DEVICE_NOTIFICATION_PREFS, minSeverity: 'warn' },
    })
    const cache = cacheStorage.caches.get(cacheName('device-state'))
    const stored = await cache?.match(`${ORIGIN}/__teslasync__/device-state`)
    expect(stored).toBeDefined()
    await expect(stored?.json()).resolves.toMatchObject({
      prefs: { minSeverity: 'warn' },
    })
  })
})
