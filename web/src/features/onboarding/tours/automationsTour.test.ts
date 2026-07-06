import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { AUTOMATIONS_TOUR } from './automationsTour'
import { TOURS, TOUR_ORDER, isRecommendedForRoute } from '@/lib/tourRegistry'

const VALID_PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

describe('AUTOMATIONS_TOUR', () => {
  describe('identity + metadata', () => {
    it('exposes a stable id, i18n keys, and English fallbacks', () => {
      expect(AUTOMATIONS_TOUR.id).toBe('automations')
      expect(AUTOMATIONS_TOUR.titleKey).toBe('tour.tours.automations.title')
      expect(AUTOMATIONS_TOUR.titleFallback).toBe('Automations')
      expect(AUTOMATIONS_TOUR.descriptionKey).toBe('tour.tours.automations.description')
      expect(AUTOMATIONS_TOUR.descriptionFallback.length).toBeGreaterThan(0)
    })

    it('carries a positive integer version for storage namespacing', () => {
      expect(typeof AUTOMATIONS_TOUR.version).toBe('number')
      expect(AUTOMATIONS_TOUR.version).toBeGreaterThan(0)
      expect(Number.isInteger(AUTOMATIONS_TOUR.version)).toBe(true)
    })

    it('stays launcher-only (no autoStart predicate — only the main tour opts in)', () => {
      expect(AUTOMATIONS_TOUR.autoStart).toBeUndefined()
    })

    it('is wired into the shared registry and display order exactly once', () => {
      expect(TOURS.automations).toBe(AUTOMATIONS_TOUR)
      expect(TOUR_ORDER).toContain('automations')
      expect(TOUR_ORDER.filter((id) => id === 'automations')).toHaveLength(1)
    })
  })

  describe('steps', () => {
    it('walks the builder → conditions → actions → conflicts flow in order', () => {
      const targets = AUTOMATIONS_TOUR.steps.map((s) => s.target)
      expect(targets).toEqual([
        '[data-tour="automation-builder"]',
        '[data-tour="automation-conditions"]',
        '[data-tour="automation-actions"]',
        '[data-tour="automation-conflicts"]',
      ])
    })

    it('has unique, non-empty targets and copy with a valid placement', () => {
      const { steps } = AUTOMATIONS_TOUR
      expect(steps.length).toBeGreaterThan(0)
      expect(new Set(steps.map((s) => s.target)).size).toBe(steps.length)
      for (const step of steps) {
        expect(step.target.length).toBeGreaterThan(0)
        expect(step.title.trim().length).toBeGreaterThan(0)
        expect(step.description.trim().length).toBeGreaterThan(0)
        expect(VALID_PLACEMENTS).toContain(step.placement)
      }
    })

    it('only the first step drives navigation; the rest have no side effects', () => {
      const [first, ...rest] = AUTOMATIONS_TOUR.steps
      expect(typeof first.onShow).toBe('function')
      expect(first.onHide).toBeUndefined()
      for (const step of rest) {
        expect(step.onShow).toBeUndefined()
        expect(step.onHide).toBeUndefined()
      }
    })
  })

  describe('routeMatch', () => {
    it('is a RegExp that matches the automations section and its sub-routes', () => {
      expect(AUTOMATIONS_TOUR.routeMatch).toBeInstanceOf(RegExp)
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/automations')).toBe(true)
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/automations/new')).toBe(true)
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/automations/42/edit')).toBe(true)
    })

    it('does not match the dashboard root or unrelated sections', () => {
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/')).toBe(false)
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/alerts')).toBe(false)
      expect(isRecommendedForRoute(AUTOMATIONS_TOUR, '/vehicles')).toBe(false)
    })
  })

  describe('first step onShow navigation', () => {
    const onShow = () => AUTOMATIONS_TOUR.steps[0].onShow?.()

    beforeEach(() => {
      // Reset to a route that differs from the tour target before each case.
      window.history.pushState({}, '', '/')
    })

    afterEach(() => {
      vi.restoreAllMocks()
      window.history.pushState({}, '', '/')
    })

    it('routes to /automations/new and notifies the router when off-route', () => {
      const onPopState = vi.fn()
      window.addEventListener('popstate', onPopState)
      const pushSpy = vi.spyOn(window.history, 'pushState')

      try {
        onShow()
      } finally {
        window.removeEventListener('popstate', onPopState)
      }

      expect(pushSpy).toHaveBeenCalledWith({}, '', '/automations/new')
      expect(window.location.pathname).toBe('/automations/new')
      expect(onPopState).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when the user is already on the target route', () => {
      window.history.pushState({}, '', '/automations/new')
      const onPopState = vi.fn()
      window.addEventListener('popstate', onPopState)
      const pushSpy = vi.spyOn(window.history, 'pushState')

      try {
        onShow()
      } finally {
        window.removeEventListener('popstate', onPopState)
      }

      expect(pushSpy).not.toHaveBeenCalled()
      expect(onPopState).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/automations/new')
    })

    it('swallows history failures so a bad hop never tears down the tour', () => {
      const pushSpy = vi
        .spyOn(window.history, 'pushState')
        .mockImplementation(() => {
          throw new Error('SecurityError: pushState blocked')
        })

      expect(() => onShow()).not.toThrow()
      expect(pushSpy).toHaveBeenCalledTimes(1)
    })
  })
})
