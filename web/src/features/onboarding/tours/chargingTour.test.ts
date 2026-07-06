import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { CHARGING_TOUR } from './chargingTour'
import { getTour, isRecommendedForRoute } from '@/lib/tourRegistry'

const VALID_PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

/** Deterministically reset the jsdom history/location before each assertion. */
function setPath(pathname: string): void {
  window.history.pushState({}, '', pathname)
}

describe('CHARGING_TOUR — identity & shape', () => {
  it('is registered under the "charging" id with i18n keys, fallbacks, and a positive version', () => {
    expect(CHARGING_TOUR.id).toBe('charging')
    expect(CHARGING_TOUR.titleKey).toBe('tour.tours.charging.title')
    expect(CHARGING_TOUR.titleFallback).toBe('Charging & cost analysis')
    expect(CHARGING_TOUR.descriptionKey).toBe('tour.tours.charging.description')
    expect(CHARGING_TOUR.descriptionFallback.length).toBeGreaterThan(0)
    expect(typeof CHARGING_TOUR.version).toBe('number')
    expect(CHARGING_TOUR.version).toBeGreaterThan(0)
  })

  it('stays launcher-only — it does NOT opt into an auto-start predicate (only "main" does)', () => {
    expect(CHARGING_TOUR.autoStart).toBeUndefined()
  })

  it('is resolvable from the shared tour registry by id (same reference)', () => {
    expect(getTour('charging')).toBe(CHARGING_TOUR)
  })
})

describe('CHARGING_TOUR — steps', () => {
  it('declares every step as well-formed (data-tour target, text, valid placement)', () => {
    expect(Array.isArray(CHARGING_TOUR.steps)).toBe(true)
    expect(CHARGING_TOUR.steps.length).toBeGreaterThan(0)
    for (const step of CHARGING_TOUR.steps) {
      expect(typeof step.target).toBe('string')
      expect(step.target.startsWith('[data-tour="')).toBe(true)
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.description.length).toBeGreaterThan(0)
      expect(VALID_PLACEMENTS).toContain(step.placement)
    }
  })

  it('walks the four charging surfaces in order without duplicate spotlight targets', () => {
    const targets = CHARGING_TOUR.steps.map((s) => s.target)
    expect(targets).toEqual([
      '[data-tour="charging-list"]',
      '[data-tour="charging-filters"]',
      '[data-tour="cost-analysis"]',
      '[data-tour="charging-curve"]',
    ])
    // Every highlight must be unique — a repeated target spotlights the same
    // element twice and confuses the walkthrough.
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('leaves the filters step free of an imperative onShow (it stays on /charging)', () => {
    const filters = CHARGING_TOUR.steps.find(
      (s) => s.target === '[data-tour="charging-filters"]',
    )
    expect(filters).toBeDefined()
    expect(filters?.onShow).toBeUndefined()
    // Optional-chaining call on the missing hook must be a safe no-op.
    expect(() => filters?.onShow?.()).not.toThrow()
  })
})

describe('CHARGING_TOUR — routeMatch', () => {
  it('is a RegExp that recognises every charging-family route and its sub-paths', () => {
    expect(CHARGING_TOUR.routeMatch).toBeInstanceOf(RegExp)
    const matches = [
      '/charging',
      '/charging/42',
      '/cost-analysis',
      '/cost-analysis/summary',
      '/charging-curve',
      '/smart-charge',
      '/smart-charge/settings',
    ]
    for (const path of matches) {
      expect(isRecommendedForRoute(CHARGING_TOUR, path)).toBe(true)
    }
  })

  it('rejects unrelated routes so the launcher does not mis-recommend it', () => {
    for (const path of ['/', '/drives', '/vehicles', '/settings', '/battery', '/analytics']) {
      expect(isRecommendedForRoute(CHARGING_TOUR, path)).toBe(false)
    }
  })
})

describe('CHARGING_TOUR — onShow navigation side-effects', () => {
  beforeEach(() => {
    setPath('/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setPath('/')
  })

  it('pushes the charging list route and fires popstate when the first step is shown', () => {
    const step = CHARGING_TOUR.steps[0]
    expect(step.onShow).toBeTypeOf('function')

    const pushSpy = vi.spyOn(window.history, 'pushState')
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate)
    try {
      step.onShow?.()

      expect(pushSpy).toHaveBeenCalledTimes(1)
      expect(pushSpy).toHaveBeenCalledWith({}, '', '/charging')
      expect(window.location.pathname).toBe('/charging')
      // The manual popstate is what makes the SPA router react to an
      // imperative pushState — assert it actually reaches listeners once.
      expect(popstate).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('popstate', popstate)
    }
  })

  it('is a no-op when already on the target route (no redundant history entry)', () => {
    setPath('/charging')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate)
    try {
      CHARGING_TOUR.steps[0].onShow?.()

      expect(pushSpy).not.toHaveBeenCalled()
      expect(popstate).not.toHaveBeenCalled()
      expect(window.location.pathname).toBe('/charging')
    } finally {
      window.removeEventListener('popstate', popstate)
    }
  })

  it('routes every navigating step to a path that its own routeMatch covers', () => {
    const routeMatch = CHARGING_TOUR.routeMatch as RegExp
    const navigatingSteps = CHARGING_TOUR.steps.filter((s) => typeof s.onShow === 'function')
    // The cost-analysis and curve steps both carry an onShow alongside the list.
    expect(navigatingSteps.length).toBeGreaterThanOrEqual(3)

    for (const step of navigatingSteps) {
      setPath('/')
      step.onShow?.()
      const landed = window.location.pathname
      expect(landed).not.toBe('/')
      // A navigating step must never send the user outside the tour's own
      // declared route family — otherwise the launcher badge lies.
      expect(routeMatch.test(landed)).toBe(true)
    }
  })
})
