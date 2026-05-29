import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  globalProgress,
  TRICKLE_INITIAL,
  TRICKLE_TARGET,
  TRICKLE_INTERVAL_MS,
  __resetGlobalProgressForTests,
  __getGlobalProgressStateForTests,
  type GlobalProgressListener,
} from '../globalProgress'

/**
 * globalProgress controller contract.
 *
 * Verifies the activeCount stack, idempotent stop, asymptotic trickle
 * behaviour, and listener subscribe/unsubscribe semantics. These
 * properties guarantee the <TopProgress> bar is correct under
 * concurrent route transitions and React.StrictMode double-invocation.
 */

describe('globalProgress', () => {
  beforeEach(() => {
    __resetGlobalProgressForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    __resetGlobalProgressForTests()
    vi.useRealTimers()
  })

  it('starts inactive with progress=0 and no listeners', () => {
    const state = __getGlobalProgressStateForTests()
    expect(state.activeCount).toBe(0)
    expect(state.progress).toBe(0)
    expect(state.listeners).toBe(0)
    expect(state.trickling).toBe(false)
  })

  it('start() activates the bar and publishes initial progress', () => {
    const events: Array<{ active: boolean; progress: number }> = []
    const unsubscribe = globalProgress.subscribe((active, progress) => {
      events.push({ active, progress })
    })
    // subscribe() replays current state so the first event is the (false, 0) baseline.
    expect(events).toEqual([{ active: false, progress: 0 }])

    const stop = globalProgress.start()

    expect(events.at(-1)).toEqual({ active: true, progress: TRICKLE_INITIAL })
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stop()
    unsubscribe()
  })

  it('multiple concurrent starts keep the bar active until the last stop', () => {
    let lastActive = false
    globalProgress.subscribe((active) => {
      lastActive = active
    })

    const stopA = globalProgress.start()
    const stopB = globalProgress.start()
    const stopC = globalProgress.start()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(3)
    expect(lastActive).toBe(true)

    stopA()
    expect(lastActive).toBe(true)
    expect(__getGlobalProgressStateForTests().activeCount).toBe(2)

    stopB()
    expect(lastActive).toBe(true)
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stopC()
    expect(lastActive).toBe(false)
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('stop function is idempotent — calling twice does not underflow activeCount', () => {
    const stopA = globalProgress.start()
    const stopB = globalProgress.start()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(2)

    stopA()
    stopA() // double-invoke — must be a no-op (StrictMode dev double-fire defense).
    stopA()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stopB()
    stopB()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('activeCount can never go negative even with rogue stop() calls', () => {
    const stop = globalProgress.start()
    stop()
    stop()
    stop()
    stop()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('trickle advances progress asymptotically toward TRICKLE_TARGET while active', () => {
    const stop = globalProgress.start()
    expect(__getGlobalProgressStateForTests().progress).toBe(TRICKLE_INITIAL)

    // Each tick should bump progress without ever reaching the target.
    vi.advanceTimersByTime(TRICKLE_INTERVAL_MS)
    const after1 = __getGlobalProgressStateForTests().progress
    expect(after1).toBeGreaterThan(TRICKLE_INITIAL)
    expect(after1).toBeLessThan(TRICKLE_TARGET)

    vi.advanceTimersByTime(TRICKLE_INTERVAL_MS * 50)
    const afterMany = __getGlobalProgressStateForTests().progress
    expect(afterMany).toBeLessThanOrEqual(TRICKLE_TARGET)
    expect(afterMany).toBeGreaterThan(after1)

    stop()
  })

  it('progress snaps back to 0 and trickle stops when last consumer stops', () => {
    const stop = globalProgress.start()
    vi.advanceTimersByTime(TRICKLE_INTERVAL_MS * 5)
    expect(__getGlobalProgressStateForTests().progress).toBeGreaterThan(TRICKLE_INITIAL)
    expect(__getGlobalProgressStateForTests().trickling).toBe(true)

    stop()

    expect(__getGlobalProgressStateForTests().progress).toBe(0)
    expect(__getGlobalProgressStateForTests().trickling).toBe(false)
    expect(__getGlobalProgressStateForTests().activeCount).toBe(0)
  })

  it('subscribe() returns an unsubscribe function that removes the listener', () => {
    const fn: GlobalProgressListener = vi.fn()
    const unsubscribe = globalProgress.subscribe(fn)
    // Initial replay
    expect(fn).toHaveBeenCalledTimes(1)

    const stop = globalProgress.start()
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(true, TRICKLE_INITIAL)

    unsubscribe()
    expect(__getGlobalProgressStateForTests().listeners).toBe(0)

    stop()
    // No further calls after unsubscribe.
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('listener errors do not break the controller', () => {
    const fnA = vi.fn(() => {
      throw new Error('listener boom')
    })
    const fnB = vi.fn()
    globalProgress.subscribe(fnA)
    globalProgress.subscribe(fnB)

    const stop = globalProgress.start()
    expect(fnB).toHaveBeenCalled()
    expect(__getGlobalProgressStateForTests().activeCount).toBe(1)

    stop()
  })

  it('subscribing while active immediately replays the active state', () => {
    const stop = globalProgress.start()

    const fn: GlobalProgressListener = vi.fn()
    globalProgress.subscribe(fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(true, TRICKLE_INITIAL)

    stop()
  })
})
