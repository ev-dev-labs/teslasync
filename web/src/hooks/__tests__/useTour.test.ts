import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

/**
 * useTour contract.
 *
 * `useTour` drives the onboarding spotlight in `Layout` + `TourOverlay`. It
 * owns three concerns worth pinning:
 *   1. Step navigation (start / next / prev / skip / finish) and the derived
 *      `step` / `totalSteps` / `currentStep` snapshot the overlay renders.
 *   2. Persistence — when a {@link TourPersistenceContext} is supplied,
 *      completing/skipping writes through `@/lib/tourRegistry` and announces a
 *      cross-tab broadcast so peer tabs stop re-offering the tour.
 *   3. `targetRect` resolution against the live DOM (drives the spotlight
 *      cutout and Layout's "auto-skip a missing step" timer).
 *
 * The registry + bus are fully mocked so the tests assert the exact side
 * effects without pulling in every tour definition or touching real
 * BroadcastChannel plumbing (that is covered in lib/__tests__/broadcast).
 */

vi.mock('@/lib/tourRegistry', () => ({
  markTourCompleted: vi.fn(),
  markTourSkipped: vi.fn(),
  resetAllTours: vi.fn(),
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
}))

import {
  markTourCompleted,
  markTourSkipped,
  resetAllTours,
} from '@/lib/tourRegistry'
import { broadcast } from '@/lib/broadcast'
import {
  useTour,
  isTourCompleted,
  resetTour,
  type TourStep,
  type TourPersistenceContext,
} from '../useTour'

const persistCtx: TourPersistenceContext = { id: 'main', version: 3 }

function threeSteps(): TourStep[] {
  return [
    { target: '#step-1', title: 'One', description: 'First step', placement: 'bottom' },
    { target: '#step-2', title: 'Two', description: 'Second step', placement: 'top' },
    { target: '#step-3', title: 'Three', description: 'Third step', placement: 'right' },
  ]
}

/** Mount an element the hook's `querySelector` can resolve, with a stubbed rect. */
function mountTarget(id: string, rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('div')
  el.id = id
  const full = {
    x: 20, y: 10, top: 10, left: 20, right: 120, bottom: 50,
    width: 100, height: 40, toJSON: () => ({}),
    ...rect,
  } as DOMRect
  el.getBoundingClientRect = () => full
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  window.localStorage.clear()
})

describe('useTour — initial snapshot', () => {
  it('starts inactive with the right totals and null step/targetRect', () => {
    const steps = threeSteps()
    const { result } = renderHook(() => useTour(steps, persistCtx))

    expect(result.current.isActive).toBe(false)
    expect(result.current.currentStep).toBe(0)
    expect(result.current.totalSteps).toBe(3)
    expect(result.current.step).toBeNull()
    expect(result.current.targetRect).toBeNull()
  })

  it('exposes stable callables regardless of persistence', () => {
    const { result } = renderHook(() => useTour(threeSteps()))
    expect(typeof result.current.start).toBe('function')
    expect(typeof result.current.next).toBe('function')
    expect(typeof result.current.prev).toBe('function')
    expect(typeof result.current.skip).toBe('function')
    expect(typeof result.current.finish).toBe('function')
  })
})

describe('useTour — navigation', () => {
  it('start() activates the tour and resolves the first step + its rect', () => {
    mountTarget('step-1', { top: 15 })
    const steps = threeSteps()
    const { result } = renderHook(() => useTour(steps, persistCtx))

    act(() => { result.current.start() })

    expect(result.current.isActive).toBe(true)
    expect(result.current.currentStep).toBe(0)
    expect(result.current.step).toEqual(steps[0])
    expect(result.current.targetRect?.top).toBe(15)
  })

  it('next() advances and re-resolves the rect for the new step', () => {
    mountTarget('step-1', { top: 15 })
    mountTarget('step-2', { top: 99 })
    const steps = threeSteps()
    const { result } = renderHook(() => useTour(steps, persistCtx))

    act(() => { result.current.start() })
    act(() => { result.current.next() })

    expect(result.current.currentStep).toBe(1)
    expect(result.current.step).toEqual(steps[1])
    expect(result.current.targetRect?.top).toBe(99)
  })

  it('prev() steps backward and clamps at zero', () => {
    const { result } = renderHook(() => useTour(threeSteps(), persistCtx))

    act(() => { result.current.start() })
    act(() => { result.current.next() })
    expect(result.current.currentStep).toBe(1)

    act(() => { result.current.prev() })
    expect(result.current.currentStep).toBe(0)

    act(() => { result.current.prev() })
    expect(result.current.currentStep).toBe(0)
  })

  it('reports a null targetRect when the step target is not in the DOM', () => {
    const steps = threeSteps()
    const { result } = renderHook(() => useTour(steps, persistCtx))

    act(() => { result.current.start() })

    expect(result.current.isActive).toBe(true)
    expect(result.current.step).toEqual(steps[0])
    // Drives Layout's auto-skip-missing-step timer.
    expect(result.current.targetRect).toBeNull()
  })
})

describe('useTour — completion + persistence', () => {
  it('advancing past the last step finishes the tour and records completion', () => {
    const { result } = renderHook(() => useTour(threeSteps(), persistCtx))

    act(() => { result.current.start() })
    act(() => { result.current.next() }) // -> step 1
    act(() => { result.current.next() }) // -> step 2
    act(() => { result.current.next() }) // -> finish

    expect(result.current.isActive).toBe(false)
    expect(vi.mocked(markTourCompleted)).toHaveBeenCalledWith('main', 3)
    expect(vi.mocked(markTourSkipped)).not.toHaveBeenCalled()
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith({
      type: 'tour.completed',
      tourId: 'main',
      version: 3,
    })
  })

  it('finish() deactivates and records completion', () => {
    const { result } = renderHook(() => useTour(threeSteps(), persistCtx))

    act(() => { result.current.start() })
    act(() => { result.current.finish() })

    expect(result.current.isActive).toBe(false)
    expect(vi.mocked(markTourCompleted)).toHaveBeenCalledWith('main', 3)
    expect(vi.mocked(markTourSkipped)).not.toHaveBeenCalled()
  })

  it('skip() deactivates and records a skip (still broadcasts completion)', () => {
    const { result } = renderHook(() => useTour(threeSteps(), persistCtx))

    act(() => { result.current.start() })
    act(() => { result.current.skip() })

    expect(result.current.isActive).toBe(false)
    expect(vi.mocked(markTourSkipped)).toHaveBeenCalledWith('main', 3)
    expect(vi.mocked(markTourCompleted)).not.toHaveBeenCalled()
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith({
      type: 'tour.completed',
      tourId: 'main',
      version: 3,
    })
  })

  it('finishing without a persistence context touches neither registry nor bus', () => {
    const { result } = renderHook(() => useTour(threeSteps()))

    act(() => { result.current.start() })
    act(() => { result.current.next() })
    act(() => { result.current.next() })
    act(() => { result.current.next() })

    expect(result.current.isActive).toBe(false)
    expect(vi.mocked(markTourCompleted)).not.toHaveBeenCalled()
    expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
  })

  it('skipping without a persistence context is a no-op side-effect-wise', () => {
    const { result } = renderHook(() => useTour(threeSteps()))

    act(() => { result.current.start() })
    act(() => { result.current.skip() })

    expect(result.current.isActive).toBe(false)
    expect(vi.mocked(markTourSkipped)).not.toHaveBeenCalled()
    expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
  })
})

describe('useTour — targetRect lifecycle (regression)', () => {
  it('clears a resolved targetRect once the tour ends so no stale spotlight lingers', () => {
    // Element stays mounted the whole time — the rect must still be dropped
    // when the tour deactivates, otherwise Layout would keep the previous
    // spotlight geometry around after skip/finish.
    mountTarget('step-1', { top: 15 })
    const { result } = renderHook(() => useTour(threeSteps(), persistCtx))

    act(() => { result.current.start() })
    expect(result.current.targetRect?.top).toBe(15)

    act(() => { result.current.skip() })
    expect(result.current.targetRect).toBeNull()
  })
})

describe('useTour — onShow/onHide lifecycle', () => {
  it('fires onShow when a step appears and onHide when it is left or the tour ends', () => {
    const onShow0 = vi.fn()
    const onHide0 = vi.fn()
    const onShow1 = vi.fn()
    const onHide1 = vi.fn()
    const steps: TourStep[] = [
      { target: '#step-1', title: 'One', description: 'a', placement: 'bottom', onShow: onShow0, onHide: onHide0 },
      { target: '#step-2', title: 'Two', description: 'b', placement: 'top', onShow: onShow1, onHide: onHide1 },
    ]
    const { result } = renderHook(() => useTour(steps, persistCtx))

    act(() => { result.current.start() })
    expect(onShow0).toHaveBeenCalledTimes(1)
    expect(onHide0).not.toHaveBeenCalled()

    act(() => { result.current.next() })
    expect(onHide0).toHaveBeenCalledTimes(1)
    expect(onShow1).toHaveBeenCalledTimes(1)

    act(() => { result.current.skip() })
    expect(onHide1).toHaveBeenCalledTimes(1)
  })
})

describe('useTour — defensive edges', () => {
  it('does not throw when started with an empty steps array', () => {
    const { result } = renderHook(() => useTour([]))

    expect(result.current.totalSteps).toBe(0)
    expect(result.current.step).toBeNull()
    // Regression: an empty/missing selector must not reach querySelector('').
    expect(() => act(() => { result.current.start() })).not.toThrow()
    expect(result.current.isActive).toBe(true)
    expect(result.current.step).toBeNull()
    expect(result.current.targetRect).toBeNull()
  })

  it('tolerates an undefined steps argument via the defensive default', () => {
    const { result } = renderHook(() => useTour(undefined as unknown as TourStep[]))

    expect(result.current.totalSteps).toBe(0)
    expect(result.current.step).toBeNull()
    expect(() => act(() => { result.current.start() })).not.toThrow()
  })

  it('treats a step with an empty target selector as having no rect', () => {
    const steps: TourStep[] = [
      { target: '', title: 'x', description: 'y', placement: 'bottom' },
    ]
    const { result } = renderHook(() => useTour(steps, persistCtx))

    expect(() => act(() => { result.current.start() })).not.toThrow()
    expect(result.current.targetRect).toBeNull()
  })
})

describe('deprecated legacy shims', () => {
  it('isTourCompleted() returns true only when the legacy global flag is set', () => {
    expect(isTourCompleted()).toBe(false)

    window.localStorage.setItem('teslasync-tour-completed', 'true')
    expect(isTourCompleted()).toBe(true)

    window.localStorage.setItem('teslasync-tour-completed', 'nope')
    expect(isTourCompleted()).toBe(false)
  })

  it('resetTour() delegates to resetAllTours and broadcasts a reset', () => {
    resetTour()

    expect(vi.mocked(resetAllTours)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith({ type: 'tour.reset' })
  })
})
