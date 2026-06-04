/**
 * Tour launcher helper tests.
 *
 * Verifies that `startTour(id)`:
 *   1. Clears the per-tour completion flag (delegates to `resetTour`).
 *   2. Dispatches the same-tab `TOUR_START_EVENT` window CustomEvent so
 *      Layout's existing listener picks up the request.
 *   3. Emits a cross-tab `tour.replay-requested` broadcast envelope so peer
 *      tabs of the SPA can stay in sync.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Spy on the broadcast bus before tourLauncher imports it. Using vi.mock
// here (instead of constructing a peer BroadcastChannel inside the test)
// keeps the assertion deterministic — jsdom's BroadcastChannel is fine
// for the existing broadcast.test.ts but interacts unpredictably with the
// shared singleton when a sibling test file has already mounted it.
vi.mock('../broadcast', async () => {
  const actual = await vi.importActual<typeof import('../broadcast')>('../broadcast')
  return { ...actual, broadcast: vi.fn() }
})

import { startTour } from '../tourLauncher'
import { broadcast } from '../broadcast'
import {
  TOUR_START_EVENT,
  type TourStartEventDetail,
  markTourCompleted,
  getTourStatus,
} from '../tourRegistry'

const broadcastMock = vi.mocked(broadcast)

describe('tourLauncher.startTour', () => {
  beforeEach(() => {
    window.localStorage.clear()
    broadcastMock.mockReset()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('clears the per-tour completion flag for the requested tour only', () => {
    markTourCompleted('main', 1)
    markTourCompleted('main', 2)
    markTourCompleted('debugger', 1)

    startTour('main')

    expect(getTourStatus('main', 1)).toBeNull()
    expect(getTourStatus('main', 2)).toBeNull()
    // Other tours must remain untouched.
    expect(getTourStatus('debugger', 1)).toBe('completed')
  })

  it('dispatches the same-tab TOUR_START_EVENT CustomEvent with the tour id', () => {
    const events: TourStartEventDetail[] = []
    const listener = (e: Event) => {
      events.push((e as CustomEvent<TourStartEventDetail>).detail)
    }
    window.addEventListener(TOUR_START_EVENT, listener)

    startTour('automations')

    window.removeEventListener(TOUR_START_EVENT, listener)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ id: 'automations' })
  })

  it('emits a tour.replay-requested broadcast envelope', () => {
    startTour('debugger')

    expect(broadcastMock).toHaveBeenCalledTimes(1)
    expect(broadcastMock).toHaveBeenCalledWith({
      type: 'tour.replay-requested',
      tourId: 'debugger',
    })
  })

  it('clears the completion flag BEFORE dispatching the start event', () => {
    // Behavioural invariant: when Layout's TOUR_START_EVENT listener fires,
    // the per-tour storage flag MUST already be cleared so the auto-start
    // gate sees this as a fresh run instead of a "completed" replay.
    markTourCompleted('main', 7)
    expect(getTourStatus('main', 7)).toBe('completed')

    let statusAtDispatch: string | null | 'not-fired' = 'not-fired'
    const listener = (evt: Event) => {
      const detail = (evt as CustomEvent<TourStartEventDetail>).detail
      if (detail?.id === 'main') {
        statusAtDispatch = getTourStatus('main', 7)
      }
    }
    window.addEventListener(TOUR_START_EVENT, listener)

    startTour('main')

    window.removeEventListener(TOUR_START_EVENT, listener)
    expect(statusAtDispatch).toBeNull()
  })
})
