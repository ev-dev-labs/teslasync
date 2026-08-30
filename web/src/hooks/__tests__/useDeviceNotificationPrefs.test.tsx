import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * Per-device notification preferences (PWA-05).
 *
 * The store is module-level and seeded from `localStorage` at import time, so
 * each case re-imports it with a fresh registry. The service-worker bridge is
 * asserted through a stubbed `navigator.serviceWorker`.
 */

const STORAGE_KEY = 'teslasync:device-notification-prefs:v1'

const postMessage = vi.fn()

function stubServiceWorker(available = true) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: available
      ? {
          getRegistration: vi.fn(async () => ({ active: { postMessage } })),
          controller: { postMessage },
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }
      : undefined,
  })
}

async function loadModule() {
  vi.resetModules()
  return import('../useDeviceNotificationPrefs')
}

beforeEach(() => {
  window.localStorage.clear()
  postMessage.mockClear()
  stubServiceWorker(true)
})

afterEach(() => {
  window.localStorage.clear()
})

describe('persistence', () => {
  it('starts from the shipped defaults — everything delivered', async () => {
    const { getDeviceNotificationPrefs } = await loadModule()
    const prefs = getDeviceNotificationPrefs()
    expect(prefs.enabled).toBe(true)
    expect(prefs.minSeverity).toBe('info')
    expect(prefs.vehicleScope).toBe('all')
    expect(prefs.quietHours.enabled).toBe(false)
  })

  it('rehydrates a stored policy', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, minSeverity: 'critical', vehicleScope: 'selected', vehicleIds: [3] }),
    )
    const { getDeviceNotificationPrefs } = await loadModule()
    const prefs = getDeviceNotificationPrefs()
    expect(prefs.minSeverity).toBe('critical')
    expect(prefs.vehicleIds).toEqual([3])
  })

  it('fails open on a corrupt blob rather than muting everything', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { getDeviceNotificationPrefs } = await loadModule()
    expect(getDeviceNotificationPrefs().enabled).toBe(true)
    expect(getDeviceNotificationPrefs().minSeverity).toBe('info')
  })

  it('writes a sanitised policy back to storage', async () => {
    const { updateDeviceNotificationPrefs } = await loadModule()
    updateDeviceNotificationPrefs({
      // @ts-expect-error — a stale tab could write an unknown level.
      minSeverity: 'apocalyptic',
      vehicleIds: [5, 5, 0, -2],
    })
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)
    expect(stored.minSeverity).toBe('info')
    expect(stored.vehicleIds).toEqual([5])
  })
})

describe('patch merging', () => {
  it('merges a single category without restating the rest', async () => {
    const { updateDeviceNotificationPrefs } = await loadModule()
    const next = updateDeviceNotificationPrefs({ categories: { charging: false } })
    expect(next.categories.charging).toBe(false)
    expect(next.categories.alert).toBe(true)
    expect(next.categories.battery).toBe(true)
  })

  it('merges a single quiet-hours field', async () => {
    const { updateDeviceNotificationPrefs } = await loadModule()
    const next = updateDeviceNotificationPrefs({ quietHours: { enabled: true } })
    expect(next.quietHours.enabled).toBe(true)
    expect(next.quietHours.startLocal).toBe('22:00')
    expect(next.quietHours.bypassSeverities).toEqual(['critical'])
  })
})

describe('service-worker bridge', () => {
  it('pushes every change into the worker', async () => {
    const { updateDeviceNotificationPrefs } = await loadModule()
    postMessage.mockClear()

    updateDeviceNotificationPrefs({ minSeverity: 'warn' })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled())

    const message = postMessage.mock.calls.at(-1)![0]
    expect(message.type).toContain('device-notification-prefs')
    expect(message.prefs.minSeverity).toBe('warn')
  })

  it('degrades quietly when the browser has no service worker', async () => {
    stubServiceWorker(false)
    const { postDeviceNotificationPrefsToServiceWorker, getDeviceNotificationPrefs } =
      await loadModule()
    await expect(
      postDeviceNotificationPrefsToServiceWorker(getDeviceNotificationPrefs()),
    ).resolves.toBe(false)
  })
})

describe('useDeviceNotificationPrefs', () => {
  it('re-renders on change and reports whether any filter is active', async () => {
    const { useDeviceNotificationPrefs } = await loadModule()
    const { result } = renderHook(() => useDeviceNotificationPrefs())

    expect(result.current.hasFilters).toBe(false)

    act(() => {
      result.current.updatePrefs({ minSeverity: 'critical' })
    })

    expect(result.current.prefs.minSeverity).toBe('critical')
    expect(result.current.hasFilters).toBe(true)
  })

  it.each([
    ['a muted category', { categories: { alert: false } }],
    ['a scoped vehicle list', { vehicleScope: 'selected' as const }],
    ['quiet hours', { quietHours: { enabled: true } }],
    ['the master switch', { enabled: false }],
  ])('reports hasFilters for %s', async (_label, patch) => {
    const { useDeviceNotificationPrefs } = await loadModule()
    const { result } = renderHook(() => useDeviceNotificationPrefs())
    act(() => {
      result.current.updatePrefs(patch)
    })
    expect(result.current.hasFilters).toBe(true)
  })

  it('resets back to "deliver everything"', async () => {
    const { useDeviceNotificationPrefs } = await loadModule()
    const { result } = renderHook(() => useDeviceNotificationPrefs())

    act(() => {
      result.current.updatePrefs({ enabled: false, minSeverity: 'critical' })
    })
    expect(result.current.hasFilters).toBe(true)

    act(() => {
      result.current.resetPrefs()
    })

    expect(result.current.hasFilters).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('picks up a sibling tab’s write via the storage event', async () => {
    const { useDeviceNotificationPrefs } = await loadModule()
    const { result } = renderHook(() => useDeviceNotificationPrefs())

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, minSeverity: 'critical' }),
      )
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    expect(result.current.prefs.minSeverity).toBe('critical')
  })
})
