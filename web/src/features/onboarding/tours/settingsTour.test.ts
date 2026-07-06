import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { SETTINGS_TOUR } from './settingsTour'
import { isRecommendedForRoute } from '@/lib/tourRegistry'

/** The four settings anchors the tour walks, in the order the user sees them. */
const EXPECTED_TARGETS = [
  '[data-tour="settings-appearance"]',
  '[data-tour="settings-units"]',
  '[data-tour="settings-notifications"]',
  '[data-tour="settings-tour"]',
]

const VALID_PLACEMENTS = new Set(['top', 'bottom', 'left', 'right'])

describe('SETTINGS_TOUR definition', () => {
  it('carries the settings identity + i18n metadata', () => {
    expect(SETTINGS_TOUR.id).toBe('settings')
    expect(SETTINGS_TOUR.titleKey).toBe('tour.tours.settings.title')
    expect(SETTINGS_TOUR.titleFallback).toBe('Settings')
    expect(SETTINGS_TOUR.descriptionKey).toBe('tour.tours.settings.description')
    expect(SETTINGS_TOUR.descriptionFallback).toBe('Theme, units, notifications, and tours.')
  })

  it('declares a positive integer version and stays launcher-only (no auto-start)', () => {
    expect(typeof SETTINGS_TOUR.version).toBe('number')
    expect(Number.isInteger(SETTINGS_TOUR.version)).toBe(true)
    expect(SETTINGS_TOUR.version).toBeGreaterThan(0)
    // Only the `main` tour opts into auto-start; every feature tour is explicit.
    expect(SETTINGS_TOUR.autoStart).toBeUndefined()
  })

  it('walks the four settings anchors in order', () => {
    expect(SETTINGS_TOUR.steps).toHaveLength(4)
    expect(SETTINGS_TOUR.steps.map((step) => step.target)).toEqual(EXPECTED_TARGETS)
  })

  it('exposes only well-formed steps with a valid placement', () => {
    for (const step of SETTINGS_TOUR.steps) {
      expect(typeof step.target).toBe('string')
      expect(step.target.length).toBeGreaterThan(0)
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.description.trim().length).toBeGreaterThan(0)
      expect(VALID_PLACEMENTS.has(step.placement)).toBe(true)
    }
  })

  it('uses unique anchors so the spotlight never targets two panels at once', () => {
    const targets = SETTINGS_TOUR.steps.map((step) => step.target)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('keeps developer-internal "(Prompt NN)" references out of user-facing copy', () => {
    // Regression guard: these leaked from the prompt-numbering system into the
    // tour tooltips (e.g. the units step title used to read "Units (Prompt 21)").
    const promptRef = /\(Prompt \d+\)/i
    for (const step of SETTINGS_TOUR.steps) {
      expect(promptRef.test(step.title)).toBe(false)
      expect(promptRef.test(step.description)).toBe(false)
    }
    expect(promptRef.test(SETTINGS_TOUR.titleFallback)).toBe(false)
    expect(promptRef.test(SETTINGS_TOUR.descriptionFallback)).toBe(false)
  })
})

describe('SETTINGS_TOUR routeMatch', () => {
  it('recommends the tour on the settings route and its sub-routes', () => {
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/settings')).toBe(true)
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/settings/units')).toBe(true)
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/settings/notifications')).toBe(true)
  })

  it('does not recommend the tour on unrelated routes', () => {
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/')).toBe(false)
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/vehicles')).toBe(false)
    expect(isRecommendedForRoute(SETTINGS_TOUR, '/charging')).toBe(false)
  })
})

describe('SETTINGS_TOUR appearance-step navigation (onShow)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('wires onShow only on the first (appearance) step', () => {
    expect(typeof SETTINGS_TOUR.steps[0].onShow).toBe('function')
    expect(SETTINGS_TOUR.steps[1].onShow).toBeUndefined()
    expect(SETTINGS_TOUR.steps[2].onShow).toBeUndefined()
    expect(SETTINGS_TOUR.steps[3].onShow).toBeUndefined()
  })

  it('pushes /settings and fires popstate when the user is elsewhere', () => {
    window.history.replaceState({}, '', '/dashboard')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    let popstateCount = 0
    const onPopstate = () => {
      popstateCount += 1
    }
    window.addEventListener('popstate', onPopstate)

    SETTINGS_TOUR.steps[0].onShow?.()

    window.removeEventListener('popstate', onPopstate)
    expect(pushSpy).toHaveBeenCalledWith({}, '', '/settings')
    expect(window.location.pathname).toBe('/settings')
    expect(popstateCount).toBe(1)
  })

  it('is a no-op when the user is already on /settings (no history churn)', () => {
    window.history.replaceState({}, '', '/settings')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    let popstateCount = 0
    const onPopstate = () => {
      popstateCount += 1
    }
    window.addEventListener('popstate', onPopstate)

    SETTINGS_TOUR.steps[0].onShow?.()

    window.removeEventListener('popstate', onPopstate)
    expect(pushSpy).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/settings')
    expect(popstateCount).toBe(0)
  })
})
