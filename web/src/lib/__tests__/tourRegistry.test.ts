/**
 * Phase-46 / Prompt 61 — Tour registry storage primitives.
 *
 * Focused regression tests for the storage helpers that `startTour` (in
 * `../tourLauncher.ts`) leans on. Broader end-to-end registry coverage
 * lives in `web/src/features/onboarding/__tests__/tours.test.ts`; these
 * tests pin the surface area that prompt-61 specifically depends on so a
 * future renaming of the storage key shape doesn't silently break the
 * Settings → Product tours panel.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resetTour,
  resetAllTours,
  markTourCompleted,
  markTourSkipped,
  getTourStatus,
  isTourCompleted,
  TOUR_START_EVENT,
  dispatchTourStart,
  type TourStartEventDetail,
} from '../tourRegistry'

describe('tourRegistry — storage primitives required by Prompt 61', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  describe('resetTour', () => {
    it('clears every version of the requested tour only', () => {
      markTourCompleted('main', 1)
      markTourCompleted('main', 2)
      markTourCompleted('debugger', 1)
      markTourCompleted('automations', 3)

      resetTour('main')

      expect(getTourStatus('main', 1)).toBeNull()
      expect(getTourStatus('main', 2)).toBeNull()
      expect(getTourStatus('debugger', 1)).toBe('completed')
      expect(getTourStatus('automations', 3)).toBe('completed')
    })

    it('clears a tour whose stored status was "skipped"', () => {
      markTourSkipped('debugger', 1)
      expect(isTourCompleted('debugger', 1)).toBe(true)

      resetTour('debugger')

      expect(getTourStatus('debugger', 1)).toBeNull()
      expect(isTourCompleted('debugger', 1)).toBe(false)
    })

    it('is a safe no-op when the tour has never been recorded', () => {
      expect(() => resetTour('main')).not.toThrow()
      expect(getTourStatus('main', 1)).toBeNull()
    })

    it('does not strip unrelated localStorage entries', () => {
      window.localStorage.setItem('teslasync:other:v1:main', 'leave-me-alone')
      markTourCompleted('main', 1)

      resetTour('main')

      expect(window.localStorage.getItem('teslasync:other:v1:main')).toBe('leave-me-alone')
      expect(getTourStatus('main', 1)).toBeNull()
    })
  })

  describe('resetAllTours', () => {
    it('clears every per-tour entry plus the legacy global flag', () => {
      markTourCompleted('main', 1)
      markTourCompleted('debugger', 1)
      window.localStorage.setItem('teslasync-tour-completed', 'true')

      resetAllTours()

      expect(getTourStatus('main', 1)).toBeNull()
      expect(getTourStatus('debugger', 1)).toBeNull()
      expect(window.localStorage.getItem('teslasync-tour-completed')).toBeNull()
    })
  })

  describe('dispatchTourStart', () => {
    it('emits a CustomEvent with the requested tour id', () => {
      const events: TourStartEventDetail[] = []
      const listener = (e: Event) => {
        events.push((e as CustomEvent<TourStartEventDetail>).detail)
      }
      window.addEventListener(TOUR_START_EVENT, listener)

      dispatchTourStart('main')

      window.removeEventListener(TOUR_START_EVENT, listener)
      expect(events).toEqual([{ id: 'main' }])
    })
  })
})
