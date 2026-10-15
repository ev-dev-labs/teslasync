import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// Mock framer-motion's useReducedMotion so we can drive the hook into both
// states deterministically. framer-motion v12 caches the matchMedia value at
// module load time, so swapping `window.matchMedia` per-test is unreliable —
// mocking the export is the canonical pattern (see OnboardingPage.test.tsx).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}))

vi.mock('@/components/motion', () => {
  throw new Error('useMotionPreference must not load the FadeIn motion barrel')
})

import { getLowBandwidthMode, setLowBandwidthMode } from '../useLowBandwidthMode'
import { useMotionPreference } from '../useMotionPreference'

const originalLowBandwidthMode = getLowBandwidthMode()

describe('useMotionPreference', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
    setLowBandwidthMode('off')
  })

  afterEach(() => {
    act(() => { setLowBandwidthMode(originalLowBandwidthMode) })
  })

  it('defaults to motion enabled when prefers-reduced-motion is not set', () => {
    reducedMotionMock.mockReturnValue(false)
    const { result } = renderHook(() => useMotionPreference())
    expect(result.current.reduce).toBe(false)
    expect(result.current.durationMs).toBe(250)
  })

  it('honours the defaultMs override when motion is allowed', () => {
    reducedMotionMock.mockReturnValue(false)
    const { result } = renderHook(() => useMotionPreference(400))
    expect(result.current.reduce).toBe(false)
    expect(result.current.durationMs).toBe(400)
  })

  it('reports reduce=true and durationMs=0 when prefers-reduced-motion: reduce', () => {
    reducedMotionMock.mockReturnValue(true)
    const { result } = renderHook(() => useMotionPreference())
    expect(result.current.reduce).toBe(true)
    expect(result.current.durationMs).toBe(0)
  })

  it('returns durationMs=0 even when a custom defaultMs is provided', () => {
    reducedMotionMock.mockReturnValue(true)
    const { result } = renderHook(() => useMotionPreference(900))
    expect(result.current.reduce).toBe(true)
    expect(result.current.durationMs).toBe(0)
  })

  it('coalesces a null framer-motion result to reduce=false', () => {
    reducedMotionMock.mockReturnValue(null)
    const { result } = renderHook(() => useMotionPreference())
    expect(result.current.reduce).toBe(false)
    expect(result.current.durationMs).toBe(250)
  })

  it('reads the vendor preference without loading the motion barrel', () => {
    reducedMotionMock.mockReturnValue(true)
    const { result } = renderHook(() => useMotionPreference(400))
    expect(reducedMotionMock).toHaveBeenCalled()
    expect(result.current).toEqual({ reduce: true, durationMs: 0 })
  })

  it.each([false, null])('suppresses motion for low bandwidth when OS preference is %s', (osReduce) => {
    reducedMotionMock.mockReturnValue(osReduce)
    const { result } = renderHook(() => useMotionPreference(400))

    act(() => { setLowBandwidthMode('on') })
    expect(result.current).toEqual({ reduce: true, durationMs: 0 })

    act(() => { setLowBandwidthMode('off') })
    expect(result.current).toEqual({ reduce: false, durationMs: 400 })
  })

  it('keeps OS reduced motion when low-bandwidth mode is disabled', () => {
    reducedMotionMock.mockReturnValue(true)
    setLowBandwidthMode('on')
    const { result } = renderHook(() => useMotionPreference(900))

    act(() => { setLowBandwidthMode('off') })
    expect(result.current).toEqual({ reduce: true, durationMs: 0 })
  })
})
