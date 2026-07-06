/**
 * VEHICLES_TOUR contract.
 *
 * `vehiclesTour.ts` is a pure data module with one piece of behaviour: the
 * first step's `onShow` performs a router-agnostic SPA navigation to
 * `/vehicles` (history.pushState + a synthetic `popstate`) so the guided
 * walkthrough always begins on the fleet list, no matter where the launcher
 * was opened from. These tests pin:
 *   1. the tour's identity + i18n metadata and step shape (targets, copy,
 *      placements, and which steps drive navigation);
 *   2. the `routeMatch` regex — list AND detail routes recommend the tour,
 *      unrelated sections do not — verified both directly and through the
 *      registry's `isRecommendedForRoute` consumer;
 *   3. the tour is wired into the shared registry under the `vehicles` id;
 *   4. the first-step navigation behaviour and its idempotency guard
 *      (no history churn when the user is already on `/vehicles`).
 *
 * jsdom implements the History API, so `pushState` really mutates
 * `window.location.pathname` and dispatched `popstate` events reach real
 * listeners — no router mock is needed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { VEHICLES_TOUR } from './vehiclesTour'
import { getTour, TOUR_ORDER, isRecommendedForRoute } from '@/lib/tourRegistry'

const VALID_PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

const EXPECTED_TARGETS = [
  '[data-tour="vehicles-list"]',
  '[data-tour="vehicles-card"]',
  '[data-tour="vehicle-detail-tabs"]',
  '[data-tour="vehicle-access"]',
] as const

/** Fire the first step's onShow exactly as the tour engine would. */
const invokeFirstStep = () => VEHICLES_TOUR.steps[0]?.onShow?.()

describe('VEHICLES_TOUR definition', () => {
  it('declares a stable identity and i18n metadata', () => {
    expect(VEHICLES_TOUR.id).toBe('vehicles')
    expect(VEHICLES_TOUR.titleKey).toBe('tour.tours.vehicles.title')
    expect(VEHICLES_TOUR.descriptionKey).toBe('tour.tours.vehicles.description')
    expect(VEHICLES_TOUR.titleFallback.length).toBeGreaterThan(0)
    expect(VEHICLES_TOUR.descriptionFallback.length).toBeGreaterThan(0)
    expect(typeof VEHICLES_TOUR.version).toBe('number')
    expect(VEHICLES_TOUR.version).toBeGreaterThan(0)
  })

  it('stays launcher-only (no auto-start predicate)', () => {
    // Registry policy: only the `main` tour auto-starts; every other tour
    // must stay explicit so we never interrupt returning users.
    expect(VEHICLES_TOUR.autoStart).toBeUndefined()
  })

  it('walks the fleet in a fixed order of distinct, well-formed steps', () => {
    expect(Array.isArray(VEHICLES_TOUR.steps)).toBe(true)
    expect(VEHICLES_TOUR.steps.length).toBe(EXPECTED_TARGETS.length)

    for (const step of VEHICLES_TOUR.steps) {
      expect(typeof step.target).toBe('string')
      expect(step.target.startsWith('[data-tour="')).toBe(true)
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.description.length).toBeGreaterThan(0)
      expect(VALID_PLACEMENTS).toContain(step.placement)
    }

    const targets = VEHICLES_TOUR.steps.map((s) => s.target)
    // Exact order matters — this is a guided walkthrough, and each selector
    // must be unique so no two steps fight over the same highlight element.
    expect(targets).toEqual([...EXPECTED_TARGETS])
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('drives navigation from the first step only', () => {
    const [first, ...rest] = VEHICLES_TOUR.steps
    expect(first.target).toBe('[data-tour="vehicles-list"]')
    expect(typeof first.onShow).toBe('function')
    // The remaining steps highlight in-place; none navigate or tear down.
    for (const step of rest) {
      expect(step.onShow).toBeUndefined()
    }
    expect(VEHICLES_TOUR.steps.every((s) => s.onHide === undefined)).toBe(true)
  })
})

describe('VEHICLES_TOUR.routeMatch', () => {
  it('is a RegExp anchored at the /vehicles prefix', () => {
    expect(VEHICLES_TOUR.routeMatch).toBeInstanceOf(RegExp)
    const re = VEHICLES_TOUR.routeMatch as RegExp
    expect(re.test('/vehicles')).toBe(true)
    expect(re.test('/vehicles/42')).toBe(true) // detail page
    expect(re.test('/drives')).toBe(false)
    expect(re.test('/')).toBe(false)
  })

  it('is recognised by the registry matcher on list + detail routes', () => {
    expect(isRecommendedForRoute(VEHICLES_TOUR, '/vehicles')).toBe(true)
    expect(isRecommendedForRoute(VEHICLES_TOUR, '/vehicles/7')).toBe(true)
    expect(isRecommendedForRoute(VEHICLES_TOUR, '/charging')).toBe(false)
  })
})

describe('VEHICLES_TOUR registry wiring', () => {
  it('is registered under the "vehicles" id and listed in launcher order', () => {
    expect(getTour('vehicles')).toBe(VEHICLES_TOUR)
    expect(TOUR_ORDER).toContain('vehicles')
  })
})

describe('first-step navigation (onShow)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // Leave the shared jsdom history at a known root for the next test.
    window.history.replaceState({}, '', '/')
  })

  it('pushes /vehicles and emits popstate when opened elsewhere', () => {
    window.history.pushState({}, '', '/dashboard')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const onPopState = vi.fn()
    window.addEventListener('popstate', onPopState)
    try {
      invokeFirstStep()

      expect(pushSpy).toHaveBeenCalledTimes(1)
      expect(pushSpy).toHaveBeenCalledWith({}, '', '/vehicles')
      expect(onPopState).toHaveBeenCalledTimes(1)
      expect(window.location.pathname).toBe('/vehicles')
    } finally {
      window.removeEventListener('popstate', onPopState)
    }
  })

  it('is a no-op when already on /vehicles (no history churn)', () => {
    window.history.pushState({}, '', '/vehicles')
    // Spy AFTER arranging so the setup navigation is not counted.
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const onPopState = vi.fn()
    window.addEventListener('popstate', onPopState)
    try {
      invokeFirstStep()

      expect(pushSpy).not.toHaveBeenCalled()
      expect(onPopState).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/vehicles')
    } finally {
      window.removeEventListener('popstate', onPopState)
    }
  })

  it('routes a vehicle-detail visitor back to the list', () => {
    window.history.pushState({}, '', '/vehicles/123')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const onPopState = vi.fn()
    window.addEventListener('popstate', onPopState)
    try {
      invokeFirstStep()

      expect(pushSpy).toHaveBeenCalledWith({}, '', '/vehicles')
      expect(onPopState).toHaveBeenCalledTimes(1)
      expect(window.location.pathname).toBe('/vehicles')
    } finally {
      window.removeEventListener('popstate', onPopState)
    }
  })
})
