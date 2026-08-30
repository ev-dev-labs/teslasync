import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  API_CACHE_BUCKET_PREFIX,
  isApiReadCacheName,
  postPurgeApiCacheToServiceWorker,
  purgeApiCacheStorage,
  purgeServiceWorkerApiCache,
} from '../purgeApiCache'
import { cacheName } from '../buildContract'
import { PAGE_TO_SW } from '../swProtocol'

/**
 * Identity-transition purge of cached authenticated API reads.
 *
 * The invariant: after a sign-out / reauth, NO bucket holding the previous
 * identity's API responses may survive — including buckets written by an
 * older build id, which `cacheName()` alone would not name.
 */

const controllerPostMessage = vi.fn()

function stubController(present: boolean) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: present
      ? { controller: { postMessage: controllerPostMessage } }
      : { controller: null },
  })
}

function stubCaches(names: string[]) {
  const deleted: string[] = []
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    writable: true,
    value: {
      keys: vi.fn(async () => names),
      delete: vi.fn(async (name: string) => {
        deleted.push(name)
        return true
      }),
    },
  })
  return deleted
}

beforeEach(() => {
  controllerPostMessage.mockClear()
  stubController(true)
  stubCaches([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isApiReadCacheName', () => {
  it('matches the current build’s bucket', () => {
    expect(isApiReadCacheName(cacheName('api-reads'))).toBe(true)
  })

  it('matches a previous build’s bucket — that data is just as identity-bearing', () => {
    expect(isApiReadCacheName(`${API_CACHE_BUCKET_PREFIX}-1.0.0+deadbee`)).toBe(true)
    expect(isApiReadCacheName(API_CACHE_BUCKET_PREFIX)).toBe(true)
  })

  it.each([
    'teslasync-app-route-assets-2.0.0+abc',
    'teslasync-map-tiles',
    'teslasync-navigations-2.0.0+abc',
    'teslasync-device-state',
    'workbox-precache-v2',
    'some-other-app',
    'teslasync-api-readsomething',
  ])('does not match the unrelated cache %s', (name) => {
    expect(isApiReadCacheName(name)).toBe(false)
  })
})

describe('postPurgeApiCacheToServiceWorker', () => {
  it('dispatches the purge synchronously so a navigation cannot outrun it', () => {
    expect(postPurgeApiCacheToServiceWorker()).toBe(true)
    expect(controllerPostMessage).toHaveBeenCalledWith({
      type: PAGE_TO_SW.purgeApiCache,
    })
  })

  it('reports failure when the page is not controlled by a worker', () => {
    stubController(false)
    expect(postPurgeApiCacheToServiceWorker()).toBe(false)
  })

  it('never throws when postMessage fails on a terminated worker', () => {
    controllerPostMessage.mockImplementation(() => {
      throw new Error('InvalidStateError')
    })
    expect(() => postPurgeApiCacheToServiceWorker()).not.toThrow()
    expect(postPurgeApiCacheToServiceWorker()).toBe(false)
  })
})

describe('purgeApiCacheStorage', () => {
  it('deletes API buckets from every build and leaves the rest alone', async () => {
    const deleted = stubCaches([
      cacheName('api-reads'),
      `${API_CACHE_BUCKET_PREFIX}-1.0.0+oldbuil`,
      cacheName('app-route-assets'),
      cacheName('map-tiles'),
      cacheName('device-state'),
      'workbox-precache-v2',
    ])

    await expect(purgeApiCacheStorage()).resolves.toBe(2)
    expect(deleted).toEqual([
      cacheName('api-reads'),
      `${API_CACHE_BUCKET_PREFIX}-1.0.0+oldbuil`,
    ])
  })

  it('resolves 0 rather than rejecting when Cache Storage is unavailable', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    await expect(purgeApiCacheStorage()).resolves.toBe(0)
  })

  it('resolves 0 rather than rejecting when Cache Storage throws', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      writable: true,
      value: {
        keys: vi.fn(async () => {
          throw new Error('SecurityError')
        }),
        delete: vi.fn(),
      },
    })
    await expect(purgeApiCacheStorage()).resolves.toBe(0)
  })
})

describe('purgeServiceWorkerApiCache', () => {
  it('runs both mechanisms so an uncontrolled page is still purged', async () => {
    const deleted = stubCaches([cacheName('api-reads')])

    purgeServiceWorkerApiCache()

    // Worker-side purge is dispatched immediately, before any await.
    expect(controllerPostMessage).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(deleted).toContain(cacheName('api-reads')))
  })

  it('still sweeps storage when there is no controller to message', async () => {
    stubController(false)
    const deleted = stubCaches([cacheName('api-reads')])

    purgeServiceWorkerApiCache()

    expect(controllerPostMessage).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(deleted).toContain(cacheName('api-reads')))
  })

  it('is synchronous and never throws — a sign-out must not be blockable', () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    stubController(false)
    expect(() => purgeServiceWorkerApiCache()).not.toThrow()
  })
})
