import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * Low-bandwidth mode (PWA-07).
 *
 * The store keeps module-level state seeded from `localStorage` at import
 * time, so every case re-imports it with a fresh module registry after
 * arranging storage and `navigator.connection`.
 */

const STORAGE_KEY = 'teslasync:low-bandwidth:v1'

type ConnectionStub = {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: ReturnType<typeof vi.fn>
  removeEventListener?: ReturnType<typeof vi.fn>
}

function stubConnection(connection: ConnectionStub | undefined) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    writable: true,
    value: connection,
  })
}

async function loadModule() {
  vi.resetModules()
  return import('../useLowBandwidthMode')
}

beforeEach(() => {
  window.localStorage.clear()
  stubConnection(undefined)
})

afterEach(() => {
  window.localStorage.clear()
})

describe('resolveLowBandwidth', () => {
  it('follows the network in automatic mode', async () => {
    const { resolveLowBandwidth } = await loadModule()
    expect(resolveLowBandwidth('auto', false)).toEqual({
      mode: 'auto',
      enabled: false,
      source: 'none',
    })
    expect(resolveLowBandwidth('auto', true)).toEqual({
      mode: 'auto',
      enabled: true,
      source: 'network',
    })
  })

  it('lets an explicit "on" win even on a fast link', async () => {
    const { resolveLowBandwidth } = await loadModule()
    expect(resolveLowBandwidth('on', false)).toEqual({
      mode: 'on',
      enabled: true,
      source: 'user',
    })
  })

  it('lets an explicit "off" override the browser heuristic', async () => {
    // A user who has deliberately opted out must not be second-guessed by
    // an OS Data Saver toggle they may not even know is on.
    const { resolveLowBandwidth } = await loadModule()
    expect(resolveLowBandwidth('off', true)).toEqual({
      mode: 'off',
      enabled: false,
      source: 'none',
    })
  })
})

describe('readNetworkSaveData', () => {
  it('is false when the browser exposes no NetworkInformation', async () => {
    const { readNetworkSaveData } = await loadModule()
    expect(readNetworkSaveData()).toBe(false)
  })

  it('honours an explicit saveData flag', async () => {
    stubConnection({ saveData: true })
    const { readNetworkSaveData } = await loadModule()
    expect(readNetworkSaveData()).toBe(true)
  })

  it.each(['slow-2g', '2g'])('treats effectiveType %s as constrained', async (type) => {
    stubConnection({ effectiveType: type })
    const { readNetworkSaveData } = await loadModule()
    expect(readNetworkSaveData()).toBe(true)
  })

  it.each(['3g', '4g', undefined])('treats effectiveType %s as unconstrained', async (type) => {
    stubConnection({ effectiveType: type })
    const { readNetworkSaveData } = await loadModule()
    expect(readNetworkSaveData()).toBe(false)
  })
})

describe('persistence', () => {
  it('defaults to automatic when nothing is stored', async () => {
    const { getLowBandwidthMode } = await loadModule()
    expect(getLowBandwidthMode()).toBe('auto')
  })

  it('rehydrates a stored preference', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'on')
    const { getLowBandwidthMode, isLowBandwidthActive } = await loadModule()
    expect(getLowBandwidthMode()).toBe('on')
    expect(isLowBandwidthActive()).toBe(true)
  })

  it('ignores a corrupt stored value instead of throwing', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'MAXIMUM')
    const { getLowBandwidthMode } = await loadModule()
    expect(getLowBandwidthMode()).toBe('auto')
  })

  it('writes through on set', async () => {
    const { setLowBandwidthMode } = await loadModule()
    setLowBandwidthMode('on')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('on')
  })

  it('coerces an unknown mode back to the default', async () => {
    const { setLowBandwidthMode, getLowBandwidthMode } = await loadModule()
    // @ts-expect-error — deliberately invalid input from a stale tab.
    setLowBandwidthMode('turbo')
    expect(getLowBandwidthMode()).toBe('auto')
  })
})

describe('useLowBandwidthMode', () => {
  it('re-renders subscribers when the preference changes', async () => {
    const { useLowBandwidthMode, setLowBandwidthMode } = await loadModule()
    const { result } = renderHook(() => useLowBandwidthMode())

    expect(result.current.enabled).toBe(false)
    expect(result.current.source).toBe('none')

    act(() => {
      setLowBandwidthMode('on')
    })

    expect(result.current.enabled).toBe(true)
    expect(result.current.mode).toBe('on')
    expect(result.current.source).toBe('user')
  })

  it('exposes a setter that persists', async () => {
    const { useLowBandwidthMode } = await loadModule()
    const { result } = renderHook(() => useLowBandwidthMode())

    act(() => {
      result.current.setMode('off')
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('off')
    expect(result.current.mode).toBe('off')
  })

  it('picks up a sibling tab’s write via the storage event', async () => {
    const { useLowBandwidthMode } = await loadModule()
    const { result } = renderHook(() => useLowBandwidthMode())

    act(() => {
      window.localStorage.setItem(STORAGE_KEY, 'on')
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    })

    expect(result.current.enabled).toBe(true)
  })

  it('reflects the network signal without a stored preference', async () => {
    stubConnection({ saveData: true })
    const { useLowBandwidthMode } = await loadModule()
    const { result } = renderHook(() => useLowBandwidthMode())

    expect(result.current.mode).toBe('auto')
    expect(result.current.enabled).toBe(true)
    expect(result.current.source).toBe('network')
  })
})

describe('data-saver policy', () => {
  it('leaves everything at full quality when inactive', async () => {
    const { resolveDataSaverPolicy } = await loadModule()
    expect(resolveDataSaverPolicy(false)).toEqual({
      lowBandwidth: false,
      animations: true,
      prefetch: true,
      richMapTiles: true,
      chartPointBudget: 400,
      pollingIntervalMultiplier: 1,
    })
  })

  it('throttles every knob when active', async () => {
    const { resolveDataSaverPolicy } = await loadModule()
    const policy = resolveDataSaverPolicy(true)
    expect(policy.lowBandwidth).toBe(true)
    expect(policy.animations).toBe(false)
    expect(policy.prefetch).toBe(false)
    expect(policy.richMapTiles).toBe(false)
    expect(policy.chartPointBudget).toBeLessThan(400)
    expect(policy.pollingIntervalMultiplier).toBeGreaterThan(1)
  })

  it('hands out a fresh object so a consumer cannot mutate the shared policy', async () => {
    const { resolveDataSaverPolicy } = await loadModule()
    const a = resolveDataSaverPolicy(true)
    a.animations = true
    expect(resolveDataSaverPolicy(true).animations).toBe(false)
  })

  it('drives useDataSaverPolicy from the live preference', async () => {
    const { useDataSaverPolicy, setLowBandwidthMode } = await loadModule()
    const { result } = renderHook(() => useDataSaverPolicy())

    expect(result.current.richMapTiles).toBe(true)
    act(() => {
      setLowBandwidthMode('on')
    })
    expect(result.current.richMapTiles).toBe(false)
    expect(result.current.animations).toBe(false)
  })
})
