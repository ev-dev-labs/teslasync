import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock framer-motion's useReducedMotion so we can drive the hook into both
// states deterministically. framer-motion v12 caches the matchMedia value at
// module load time, so swapping `window.matchMedia` per-test is unreliable —
// mocking the export is the canonical pattern (see OnboardingPage.test.tsx).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}))

import { useMotionPreference } from '../useMotionPreference'

describe('useMotionPreference', () => {
  beforeEach(() => {
    reducedMotionMock.mockReset()
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
})
