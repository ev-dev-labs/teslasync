import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * Update lifecycle (PWA-03) and the API-contract handshake (PWA-04).
 *
 * The four behaviours this file exists to pin:
 *   1. nothing reloads on a timer or behind the user's back,
 *   2. unsaved work blocks the reload through the shared navigation guard,
 *   3. a contract break escalates the prompt to REQUIRED and purges the
 *      cached API reads captured against the previous contract,
 *   4. sibling tabs coordinate — clean ones reload, dirty ones do not.
 */

const harness = vi.hoisted(() => ({
  needRefresh: false,
  registration: null as { update: ReturnType<typeof vi.fn> } | null,
  updateServiceWorker: vi.fn(async () => {}),
  confirmIfDirty: vi.fn(async () => true),
  bootVersion: null as string | null,
  latestVersion: null as string | null,
  setNeedRefresh: vi.fn(),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: {
    onRegisteredSW?: (url: string, reg?: unknown) => void
    onRegisterError?: (e: unknown) => void
  }) => {
    // Deliver the registration synchronously, the way the plugin does once
    // navigator.serviceWorker.register resolves.
    options.onRegisteredSW?.('/sw.js', harness.registration ?? undefined)
    return {
      needRefresh: [harness.needRefresh, harness.setNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: harness.updateServiceWorker,
    }
  },
}))

vi.mock('@/components/feedback/NavigationGuardProvider', () => ({
  useNavigationGuardContext: () => ({
    register: () => () => {},
    confirmIfDirty: harness.confirmIfDirty,
  }),
}))

vi.mock('@/hooks/useVersionWatcher', () => ({
  useVersionWatcher: () => ({
    bootVersion: harness.bootVersion,
    latestVersion: harness.latestVersion,
    newVersionAvailable:
      harness.bootVersion != null
      && harness.latestVersion != null
      && harness.bootVersion !== harness.latestVersion,
  }),
}))

import {
  FOREGROUND_UPDATE_CHECK_AFTER_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_SNOOZE_MS,
  usePwaUpdate,
} from '../usePwaUpdate'
import { APP_VERSION, BUILD_ID } from '@/sw/buildContract'

const controllerPostMessage = vi.fn()

function stubServiceWorkerController() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: {
      controller: { postMessage: controllerPostMessage },
      getRegistration: vi.fn(async () => harness.registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.needRefresh = false
  harness.registration = { update: vi.fn(async () => {}) }
  harness.updateServiceWorker.mockClear()
  harness.updateServiceWorker.mockResolvedValue(undefined)
  harness.confirmIfDirty.mockClear()
  harness.confirmIfDirty.mockResolvedValue(true)
  harness.setNeedRefresh.mockClear()
  harness.bootVersion = APP_VERSION
  harness.latestVersion = APP_VERSION
  controllerPostMessage.mockClear()
  stubServiceWorkerController()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('detection', () => {
  it('renders no prompt when nothing is waiting', () => {
    const { result } = renderHook(() => usePwaUpdate())
    expect(result.current.updateReady).toBe(false)
    expect(result.current.showPrompt).toBe(false)
  })

  it('surfaces the prompt when a worker is waiting', () => {
    harness.needRefresh = true
    const { result } = renderHook(() => usePwaUpdate())
    expect(result.current.updateReady).toBe(true)
    expect(result.current.showPrompt).toBe(true)
    expect(result.current.updateRequired).toBe(false)
  })

  it('never reloads on its own', () => {
    harness.needRefresh = true
    renderHook(() => usePwaUpdate())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    // The old banner counted down from 3s and reloaded. That is exactly what
    // must not happen any more.
    expect(harness.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('polls for a new worker on an interval', () => {
    renderHook(() => usePwaUpdate())
    expect(harness.registration!.update).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
    })
    expect(harness.registration!.update).toHaveBeenCalledTimes(1)
  })

  it('checks again after a long background period, when timers were throttled', () => {
    renderHook(() => usePwaUpdate())

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => {
      vi.advanceTimersByTime(FOREGROUND_UPDATE_CHECK_AFTER_MS + 1000)
    })
    harness.registration!.update.mockClear()

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(harness.registration!.update).toHaveBeenCalledTimes(1)
  })

  it('does not check after a momentary tab switch', () => {
    renderHook(() => usePwaUpdate())
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    harness.registration!.update.mockClear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(harness.registration!.update).not.toHaveBeenCalled()
  })

  it('swallows a failed update check rather than surfacing an error', async () => {
    harness.registration!.update.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePwaUpdate())
    await expect(result.current.checkForUpdate()).resolves.toBeUndefined()
  })
})

describe('release context', () => {
  it('reports the running build and the live backend version', () => {
    harness.bootVersion = '2.0.0'
    harness.latestVersion = '2.1.0'
    const { result } = renderHook(() => usePwaUpdate())

    expect(result.current.release.runningBuildId).toBe(BUILD_ID)
    expect(result.current.release.runningAppVersion).toBe(APP_VERSION)
    expect(result.current.release.bootServerVersion).toBe('2.0.0')
    expect(result.current.release.latestServerVersion).toBe('2.1.0')
    expect(result.current.release.serverRedeployed).toBe(true)
  })
})

describe('contract handshake', () => {
  it('escalates to a required update when the server has moved ahead', async () => {
    harness.latestVersion = '999.0.0'
    const { result } = renderHook(() => usePwaUpdate())

    expect(result.current.updateRequired).toBe(true)
    expect(result.current.showPrompt).toBe(true)
    expect(result.current.handshake.verdict).toBe('assets-stale')
  })

  it('purges the cached API reads captured against the previous contract', () => {
    harness.latestVersion = '999.0.0'
    renderHook(() => usePwaUpdate())

    // The purge is a synchronous postMessage fired from a mount effect.
    expect(controllerPostMessage).toHaveBeenCalledTimes(1)
    expect(controllerPostMessage.mock.calls[0][0].type).toContain('purge-api-cache')
  })

  it('purges only once per server version', () => {
    harness.latestVersion = '999.0.0'
    const { rerender } = renderHook(() => usePwaUpdate())
    expect(controllerPostMessage).toHaveBeenCalledTimes(1)
    rerender()
    rerender()
    expect(controllerPostMessage).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the server is merely behind (rolling deploy)', () => {
    harness.latestVersion = '0.0.1'
    const { result } = renderHook(() => usePwaUpdate())
    expect(result.current.handshake.verdict).toBe('server-behind')
    expect(result.current.updateRequired).toBe(false)
    expect(result.current.showPrompt).toBe(false)
  })

  it('stays quiet when the server reports a dev build', () => {
    harness.bootVersion = 'dev'
    harness.latestVersion = 'dev'
    const { result } = renderHook(() => usePwaUpdate())
    expect(result.current.handshake.verdict).toBe('unknown')
    expect(result.current.updateRequired).toBe(false)
  })
})

describe('applying an update', () => {
  it('asks the navigation guard before reloading', async () => {
    harness.needRefresh = true
    const { result } = renderHook(() => usePwaUpdate())

    await act(async () => {
      await result.current.applyUpdate()
    })

    expect(harness.confirmIfDirty).toHaveBeenCalledTimes(1)
    expect(harness.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('refuses to reload when the user keeps editing', async () => {
    harness.needRefresh = true
    harness.confirmIfDirty.mockResolvedValue(false)
    const { result } = renderHook(() => usePwaUpdate())

    await act(async () => {
      await result.current.applyUpdate()
    })

    expect(harness.updateServiceWorker).not.toHaveBeenCalled()
    expect(result.current.blockedByUnsavedWork).toBe(true)
    // The banner stays up so the user can retry after saving.
    expect(result.current.showPrompt).toBe(true)
  })

  it('clears the blocked flag on a subsequent successful apply', async () => {
    harness.needRefresh = true
    harness.confirmIfDirty.mockResolvedValueOnce(false)
    const { result } = renderHook(() => usePwaUpdate())

    await act(async () => {
      await result.current.applyUpdate()
    })
    expect(result.current.blockedByUnsavedWork).toBe(true)

    await act(async () => {
      await result.current.applyUpdate()
    })
    expect(result.current.blockedByUnsavedWork).toBe(false)
    expect(harness.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('recovers the button when updateServiceWorker rejects', async () => {
    harness.needRefresh = true
    harness.updateServiceWorker.mockRejectedValue(new Error('sw gone'))
    const { result } = renderHook(() => usePwaUpdate())

    await act(async () => {
      await result.current.applyUpdate()
    })

    expect(result.current.applying).toBe(false)
  })
})

describe('deferring an update', () => {
  it('hides the prompt for the snooze window, then brings back the SAME waiting worker', () => {
    // Regression guard. `deferUpdate` used to call `setNeedRefresh(false)`,
    // which cleared vite-plugin-pwa's "a worker is installed and waiting"
    // flag. That flag is only ever set again when a *different* worker
    // finishes installing, so "Later" silently meant "never" for the worker
    // that was already waiting — the user lost the update until the next
    // deploy. Visibility must be gated by `snoozedUntil` alone.
    harness.needRefresh = true
    const { result } = renderHook(() => usePwaUpdate())

    expect(result.current.showPrompt).toBe(true)

    act(() => {
      result.current.deferUpdate()
    })

    // Hidden, but the waiting worker is still tracked.
    expect(result.current.showPrompt).toBe(false)
    expect(result.current.updateReady).toBe(true)
    expect(result.current.snoozedUntil).toBe(Date.now() + UPDATE_SNOOZE_MS)
    // The plugin's flag must NOT have been cleared.
    expect(harness.setNeedRefresh).not.toHaveBeenCalledWith(false)

    // Still hidden one millisecond before the snooze expires.
    act(() => {
      vi.advanceTimersByTime(UPDATE_SNOOZE_MS - 1)
    })
    expect(result.current.showPrompt).toBe(false)

    // …and back, for the same worker, with no new install required.
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(result.current.snoozedUntil).toBeNull()
    expect(result.current.showPrompt).toBe(true)
    expect(result.current.updateReady).toBe(true)
  })

  it('can be deferred again after the snooze expires', () => {
    harness.needRefresh = true
    const { result } = renderHook(() => usePwaUpdate())

    act(() => {
      result.current.deferUpdate()
    })
    act(() => {
      vi.advanceTimersByTime(UPDATE_SNOOZE_MS + 1)
    })
    expect(result.current.showPrompt).toBe(true)

    act(() => {
      result.current.deferUpdate()
    })
    expect(result.current.showPrompt).toBe(false)

    act(() => {
      vi.advanceTimersByTime(UPDATE_SNOOZE_MS + 1)
    })
    expect(result.current.showPrompt).toBe(true)
  })

  it('still applies the deferred update when the user comes back to it', async () => {
    harness.needRefresh = true
    const { result } = renderHook(() => usePwaUpdate())

    act(() => {
      result.current.deferUpdate()
    })
    act(() => {
      vi.advanceTimersByTime(UPDATE_SNOOZE_MS + 1)
    })

    await act(async () => {
      await result.current.applyUpdate()
    })
    expect(harness.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('refuses to snooze a REQUIRED update', () => {
    harness.latestVersion = '999.0.0'
    const { result } = renderHook(() => usePwaUpdate())

    act(() => {
      result.current.deferUpdate()
    })

    expect(result.current.showPrompt).toBe(true)
    expect(result.current.snoozedUntil).toBeNull()
    expect(harness.setNeedRefresh).not.toHaveBeenCalled()
  })
})
