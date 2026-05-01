import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Mock useSettings -------------------------------------------------------
let mockCriticalFlashEnabled: boolean | undefined = true
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { critical_flash_enabled: mockCriticalFlashEnabled },
  }),
}))

// --- Mock useMotionPreference ----------------------------------------------
let mockReduce = false
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: mockReduce, durationMs: 250 }),
}))

// --- Mock react-i18next -----------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

// --- Mock sseManager --------------------------------------------------------
type Listener = (data: unknown) => void
const sseListeners = new Map<string, Set<Listener>>()
vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, listener: Listener) => {
      if (!sseListeners.has(event)) sseListeners.set(event, new Set())
      sseListeners.get(event)!.add(listener)
    },
    unsubscribe: (event: string, listener: Listener) => {
      sseListeners.get(event)?.delete(listener)
    },
  },
}))

import { useCriticalAlertFlash } from '../useCriticalAlertFlash'
import { __resetTitleStoreForTests, setBaseTitle } from '@/lib/titleStore'

function fireAlert(data: unknown) {
  const subs = sseListeners.get('alert')
  if (!subs) return
  for (const fn of subs) fn(data)
}

function setHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => value,
  })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (value ? 'hidden' : 'visible'),
  })
}

describe('useCriticalAlertFlash', () => {
  beforeEach(() => {
    sseListeners.clear()
    mockCriticalFlashEnabled = true
    mockReduce = false
    setHidden(true)
    __resetTitleStoreForTests()
    setBaseTitle('TeslaSync')
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setHidden(false)
  })

  it('subscribes to the SSE alert channel on mount', () => {
    renderHook(() => useCriticalAlertFlash())
    expect(sseListeners.get('alert')?.size).toBe(1)
  })

  it('flashes the title when a critical alert fires while hidden', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    // First frame paints synchronously (no 600ms wait).
    expect(document.title).toBe('(!) ALERT — TeslaSync')
    act(() => { vi.advanceTimersByTime(600) })
    expect(document.title).toBe('TeslaSync')
    act(() => { vi.advanceTimersByTime(600) })
    expect(document.title).toBe('(!) ALERT — TeslaSync')
    // Run all 6 frames; final state should be the unprefixed title.
    act(() => { vi.advanceTimersByTime(600 * 4) })
    expect(document.title).toBe('TeslaSync')
  })

  it('ignores non-critical alerts', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'warning' })
    })
    expect(document.title).toBe('TeslaSync')
  })

  it('ignores quiet-hours-suppressed alerts', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical', quiet_suppressed: true })
    })
    expect(document.title).toBe('TeslaSync')
  })

  it('ignores test alerts', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical', is_test: true })
    })
    expect(document.title).toBe('TeslaSync')
  })

  it('does not flash when the tab is visible', () => {
    setHidden(false)
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    expect(document.title).toBe('TeslaSync')
  })

  it('respects the disabled toggle', () => {
    mockCriticalFlashEnabled = false
    renderHook(() => useCriticalAlertFlash())
    expect(sseListeners.get('alert')?.size ?? 0).toBe(0)
  })

  it('respects prefers-reduced-motion', () => {
    mockReduce = true
    renderHook(() => useCriticalAlertFlash())
    expect(sseListeners.get('alert')?.size ?? 0).toBe(0)
  })

  it('stops flashing immediately when the tab becomes visible', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    expect(document.title).toBe('(!) ALERT — TeslaSync')
    act(() => {
      setHidden(false)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(document.title).toBe('TeslaSync')
  })

  it('clears the flash and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    expect(document.title).toBe('(!) ALERT — TeslaSync')
    unmount()
    expect(document.title).toBe('TeslaSync')
    expect(sseListeners.get('alert')?.size ?? 0).toBe(0)
  })

  it('a back-to-back alert restarts the flash sequence', () => {
    renderHook(() => useCriticalAlertFlash())
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    act(() => { vi.advanceTimersByTime(600) })
    expect(document.title).toBe('TeslaSync')
    act(() => {
      fireAlert({ severity: 'critical' })
    })
    expect(document.title).toBe('(!) ALERT — TeslaSync')
  })
})
