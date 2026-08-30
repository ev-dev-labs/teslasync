import { describe, it, expect } from 'vitest'
import type { TourStep } from '@/hooks/useTour'
import { MAIN_TOUR, MAIN_TOUR_STEPS } from './tourSteps'
import { MAIN_TOUR as CANONICAL_MAIN_TOUR } from './tours/mainTour'

const PLACEMENTS: ReadonlyArray<TourStep['placement']> = ['top', 'bottom', 'left', 'right']

describe('tourSteps backwards-compat shim', () => {
  describe('MAIN_TOUR re-export', () => {
    it('re-exports the exact canonical main tour definition (identity preserved)', () => {
      expect(MAIN_TOUR).toBe(CANONICAL_MAIN_TOUR)
      expect(MAIN_TOUR.id).toBe('main')
      expect(MAIN_TOUR.routeMatch).toBe('/')
      expect(MAIN_TOUR.version).toBeGreaterThan(0)
    })

    it('carries the launcher metadata (i18n keys plus English fallbacks)', () => {
      expect(MAIN_TOUR.titleKey).toBe('tour.tours.main.title')
      expect(MAIN_TOUR.titleFallback.length).toBeGreaterThan(0)
      expect(MAIN_TOUR.descriptionKey).toBe('tour.tours.main.description')
      expect(MAIN_TOUR.descriptionFallback.length).toBeGreaterThan(0)
    })

    it('never auto-starts — the walkthrough is launcher-only (HELP-01)', () => {
      // The predicate was removed rather than narrowed. A tour that can decide
      // to start itself is a tour that can interrupt; unsolicited onboarding
      // now lives in `lib/onboardingTasks` as one inline, route-scoped,
      // dismissible hint.
      expect(MAIN_TOUR.autoStart).toBeUndefined()
    })
  })

  describe('MAIN_TOUR_STEPS', () => {
    it('mirrors the canonical step content exactly and is non-empty', () => {
      expect(MAIN_TOUR_STEPS).toEqual(CANONICAL_MAIN_TOUR.steps)
      expect(MAIN_TOUR_STEPS.length).toBe(CANONICAL_MAIN_TOUR.steps.length)
      expect(MAIN_TOUR_STEPS.length).toBeGreaterThan(0)
    })

    it('is a defensive copy — mutating it never corrupts the live registry array', () => {
      // The shim is exposed to legacy importers; it must isolate them from
      // the array shared with the tour registry and useTour.
      expect(MAIN_TOUR_STEPS).not.toBe(CANONICAL_MAIN_TOUR.steps)
      const canonicalLengthBefore = CANONICAL_MAIN_TOUR.steps.length
      const synthetic: TourStep = {
        target: '[data-tour="synthetic-mutation-probe"]',
        title: 'synthetic',
        description: 'synthetic',
        placement: 'top',
      }
      try {
        MAIN_TOUR_STEPS.push(synthetic)
        expect(MAIN_TOUR_STEPS.length).toBe(canonicalLengthBefore + 1)
        // The canonical array the app actually walks is untouched.
        expect(CANONICAL_MAIN_TOUR.steps.length).toBe(canonicalLengthBefore)
        expect(CANONICAL_MAIN_TOUR.steps).not.toContain(synthetic)
      } finally {
        // Restore so later tests in this file see the pristine shim.
        MAIN_TOUR_STEPS.pop()
      }
      expect(MAIN_TOUR_STEPS.length).toBe(canonicalLengthBefore)
    })

    it('every step is well-formed: selector target, copy, and a valid placement', () => {
      for (const step of MAIN_TOUR_STEPS) {
        expect(typeof step.target).toBe('string')
        expect(step.target.length).toBeGreaterThan(0)
        // Steps highlight real DOM anchors via data-tour attribute selectors.
        expect(step.target.startsWith('[data-tour=')).toBe(true)
        expect(step.title.length).toBeGreaterThan(0)
        expect(step.description.length).toBeGreaterThan(0)
        expect(PLACEMENTS).toContain(step.placement)
      }
    })

    it('has a unique highlight target per step (no duplicate spotlights)', () => {
      const targets = MAIN_TOUR_STEPS.map((step) => step.target)
      expect(new Set(targets).size).toBe(targets.length)
    })
  })
})
