import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ALERTS_TOUR } from './alertsTour'
import { isRecommendedForRoute } from '@/lib/tourRegistry'

const PLACEMENTS = new Set(['top', 'bottom', 'left', 'right'])

/** jsdom starts at `http://localhost/`; land tests on a neutral path so a
 * navigate() to the alerts/studio routes actually changes location. */
function setPath(pathname: string) {
  window.history.pushState({}, '', pathname)
}

beforeEach(() => {
  setPath('/')
})

afterEach(() => {
  vi.restoreAllMocks()
  setPath('/')
})

describe('ALERTS_TOUR definition', () => {
  it('exposes a stable id and i18n metadata with fallbacks', () => {
    expect(ALERTS_TOUR.id).toBe('alerts')
    expect(ALERTS_TOUR.titleKey).toBe('tour.tours.alerts.title')
    expect(ALERTS_TOUR.titleFallback).toBe('Alerts & Alert Studio')
    expect(ALERTS_TOUR.descriptionKey).toBe('tour.tours.alerts.description')
    expect(ALERTS_TOUR.descriptionFallback.length).toBeGreaterThan(0)
  })

  it('carries a positive integer version so completion flags can invalidate', () => {
    expect(typeof ALERTS_TOUR.version).toBe('number')
    expect(ALERTS_TOUR.version).toBeGreaterThan(0)
    expect(Number.isInteger(ALERTS_TOUR.version)).toBe(true)
  })

  it('stays launcher-only — never auto-starts (only the main tour opts in)', () => {
    expect(ALERTS_TOUR.autoStart).toBeUndefined()
  })
})

describe('ALERTS_TOUR steps', () => {
  it('walks the inbox then the studio across four data-tour anchors in order', () => {
    expect(Array.isArray(ALERTS_TOUR.steps)).toBe(true)
    expect(ALERTS_TOUR.steps).toHaveLength(4)
    expect(ALERTS_TOUR.steps.map((step) => step.target)).toEqual([
      '[data-tour="alerts-list"]',
      '[data-tour="alerts-filters"]',
      '[data-tour="alert-studio-builder"]',
      '[data-tour="alert-studio-channels"]',
    ])
  })

  it('gives every step a non-empty target, title, description and valid placement', () => {
    for (const step of ALERTS_TOUR.steps) {
      expect(step.target).toContain('data-tour=')
      expect(step.target.length).toBeGreaterThan(0)
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.description.length).toBeGreaterThan(0)
      expect(PLACEMENTS.has(step.placement)).toBe(true)
    }
  })

  it('uses unique targets so the spotlight never double-anchors', () => {
    const targets = ALERTS_TOUR.steps.map((step) => step.target)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('ALERTS_TOUR routeMatch', () => {
  it('is a RegExp that matches the alerts and studio routes plus sub-paths', () => {
    expect(ALERTS_TOUR.routeMatch).toBeInstanceOf(RegExp)
    const re = ALERTS_TOUR.routeMatch as RegExp
    expect(re.test('/notifications/alerts')).toBe(true)
    expect(re.test('/notifications/studio')).toBe(true)
    expect(re.test('/notifications/alerts/42')).toBe(true)
  })

  it('does not match the bare inbox root or unrelated routes', () => {
    const re = ALERTS_TOUR.routeMatch as RegExp
    expect(re.test('/notifications')).toBe(false)
    expect(re.test('/notifications/settings')).toBe(false)
    expect(re.test('/dashboard')).toBe(false)
  })

  it('is recommended for alerts/studio via the registry helper, not elsewhere', () => {
    expect(isRecommendedForRoute(ALERTS_TOUR, '/notifications/alerts')).toBe(true)
    expect(isRecommendedForRoute(ALERTS_TOUR, '/notifications/studio')).toBe(true)
    expect(isRecommendedForRoute(ALERTS_TOUR, '/vehicles')).toBe(false)
  })
})

describe('ALERTS_TOUR onShow navigation', () => {
  it('sends the inbox step to /notifications/alerts and fires popstate', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    ALERTS_TOUR.steps[0].onShow!()
    expect(window.location.pathname).toBe('/notifications/alerts')
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const event = dispatchSpy.mock.calls[0][0]
    expect(event).toBeInstanceOf(PopStateEvent)
    expect((event as Event).type).toBe('popstate')
  })

  it('sends the builder step to /notifications/studio', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    ALERTS_TOUR.steps[2].onShow!()
    expect(window.location.pathname).toBe('/notifications/studio')
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('leaves the same-page filter/channel steps without an onShow hook', () => {
    expect(ALERTS_TOUR.steps[1].onShow).toBeUndefined()
    expect(ALERTS_TOUR.steps[3].onShow).toBeUndefined()
  })

  it('is a no-op that skips pushState when already on the target route', () => {
    setPath('/notifications/alerts')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    ALERTS_TOUR.steps[0].onShow!()
    expect(pushSpy).not.toHaveBeenCalled()
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/notifications/alerts')
  })

  it('every onShow lands on a route the tour is recommended for', () => {
    for (const step of ALERTS_TOUR.steps) {
      if (typeof step.onShow !== 'function') continue
      setPath('/')
      step.onShow()
      expect(isRecommendedForRoute(ALERTS_TOUR, window.location.pathname)).toBe(true)
    }
  })

  it('never lets a pushState SecurityError bubble out and crash the tour', () => {
    const pushSpy = vi
      .spyOn(window.history, 'pushState')
      .mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    expect(() => ALERTS_TOUR.steps[0].onShow!()).not.toThrow()
    expect(pushSpy).toHaveBeenCalledTimes(1)
    // The throw happens before the popstate dispatch, so no event escapes.
    expect(dispatchSpy).not.toHaveBeenCalled()
  })
})
