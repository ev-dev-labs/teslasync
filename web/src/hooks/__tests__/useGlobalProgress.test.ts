import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import {
  globalProgress,
  TRICKLE_INITIAL,
  TRICKLE_TARGET,
  TRICKLE_INTERVAL_MS,
  __resetGlobalProgressForTests,
  __getGlobalProgressStateForTests,
} from '@/lib/globalProgress'
import { useGlobalProgress } from '../useGlobalProgress'

/**
 * useGlobalProgress contract.
 *
 * The hook is a thin, stable adapter over the globalProgress singleton.
 * These tests pin (a) the narrow `{ start }` surface, (b) the module-
 * stable + frozen identity the hook documents as safe for `useEffect`
 * dependency arrays, and (c) that driving `start()` through the hook is
 * behaviourally identical to calling `globalProgress.start()` directly —
 * activeCount stack, idempotent stop, trickle lifecycle, and subscriber
 * fan-out.
 */
describe('useGlobalProgress', () => {
  beforeEach(() => {
    __resetGlobalProgressForTests()
    // start() kicks off an asymptotic trickle interval; fake timers keep
    // it deterministic and stop a real timer leaking across cases.
    vi.useFakeTimers()
  })

  afterEach(() => {
    __resetGlobalProgressForTests()
    vi.useRealTimers()
  })

  it('exposes a narrow controller whose only surface is start()', () => {
    const { result } = renderHook(() => useGlobalProgress())

    expect(result.current).toBeTruthy()
    expect(typeof result.current.start).toBe('function')
    // subscribe() is private to <TopProgress> and must NOT leak through.
    expect(Object.keys(result.current)).toEqual(['start'])
  })

  it('returns a referentially stable handle across re-renders', () => {
    const { result, rerender } = renderHook(() => useGlobalProgress())
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
    expect(result.current.start).toBe(first.start)
  })

  it('shares one identity across independent hook instances (safe for useEffect deps)', () => {
    const a = renderHook(() => useGlobalProgress())
    const b = renderHook(() => useGlobalProgress())

    expect(a.result.current).toBe(b.result.current)
  })

  it('returns a frozen handle that cannot be mutated', () => {
    const { result } = renderHook(() => useGlobalProgress())

    expect(Object.isFrozen(result.current)).toBe(true)
    expect(() => {
      // @ts-expect-error — deliberately probing immutability at runtime.
      result.current.start = () => () => {}
    }).toThrow()
  })

  it('start() activates the global bar and seeds initial progress', () => {
    const { result } = renderHook(() => useGlobalProgress())
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)

    const stop = result.current.start()

    const state = __getGlobalProgressStateForTests()
    expect(state.activeCount).toBe(1)
    expect(state.progress).toBe(TRICKLE_INITIAL)
    expect(state.trickling).toBe(true)

    stop()
  })

  it('start() returns a stop function that clears the bar', () => {
    const { result } = renderHook(() => useGlobalProgress())

    const stop = result.current.start()
    expect(typeof stop).toBe('function')
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stop()

    const state = __getGlobalProgressStateForTests()
    expect(state.activeCount).toBe(0)
    expect(state.progress).toBe(0)
    expect(state.trickling).toBe(false)
  })

  it('fans activation out to globalProgress subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = globalProgress.subscribe(listener)
    // subscribe() replays the (false, 0) baseline immediately.
    expect(listener).toHaveBeenLastCalledWith(false, 0)

    const { result } = renderHook(() => useGlobalProgress())
    const stop = result.current.start()
    expect(listener).toHaveBeenLastCalledWith(true, TRICKLE_INITIAL)

    stop()
    expect(listener).toHaveBeenLastCalledWith(false, 0)
    unsubscribe()
  })

  it('stacks concurrent starts and stays active until the final stop', () => {
    const { result } = renderHook(() => useGlobalProgress())

    const stop1 = result.current.start()
    const stop2 = result.current.start()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(2)

    stop1()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stop2()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('the returned stop is idempotent — StrictMode double-cleanup cannot underflow', () => {
    const { result } = renderHook(() => useGlobalProgress())
    const stopA = result.current.start()
    const stopB = result.current.start()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(2)

    stopA()
    stopA()
    stopA()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stopB()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('start works when destructured — it has no this-binding dependency', () => {
    const { result } = renderHook(() => useGlobalProgress())
    const { start } = result.current

    const stop = start()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stop()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('advances the trickle toward — but never past — the ceiling while active', () => {
    const { result } = renderHook(() => useGlobalProgress())
    const stop = result.current.start()

    vi.advanceTimersByTime(TRICKLE_INTERVAL_MS)
    const afterOne = __getGlobalProgressStateForTests().progress
    expect(afterOne).toBeGreaterThan(TRICKLE_INITIAL)
    expect(afterOne).toBeLessThan(TRICKLE_TARGET)

    vi.advanceTimersByTime(TRICKLE_INTERVAL_MS * 100)
    const afterMany = __getGlobalProgressStateForTests().progress
    expect(afterMany).toBeGreaterThan(afterOne)
    expect(afterMany).toBeLessThanOrEqual(TRICKLE_TARGET)

    stop()
  })
})
