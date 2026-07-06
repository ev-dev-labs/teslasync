import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEBUGGER_TOUR } from './debuggerTour'
import { getTour, isRecommendedForRoute } from '@/lib/tourRegistry'

/**
 * Contract tests for the State-machine debugger tour.
 *
 * The module has a single export (`DEBUGGER_TOUR`) plus a private `navigate`
 * helper that is only reachable through the first step's `onShow` callback,
 * so the navigation branch is covered indirectly through that surface.
 */

const VALID_PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

// Every top-level dev-tools route the debugger tour advertises itself on.
// Mirrors the real routes wired up in App.tsx / Layout.tsx.
const COVERED_ROUTES = [
  '/state-debugger',
  '/live-monitor',
  '/signal-explorer',
  '/signal-diff',
  '/signal-gaps',
  '/mqtt-inspector',
  '/signal-log',
  '/redis-signals',
] as const

// Listeners registered during a test so they can be torn down deterministically
// even if an assertion throws mid-test.
const registeredListeners: Array<{ type: string; fn: EventListener }> = []
function trackListener(type: string, fn: EventListener) {
  window.addEventListener(type, fn)
  registeredListeners.push({ type, fn })
}

beforeEach(() => {
  // Normalise the jsdom URL so navigation assertions start from a known root.
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  for (const { type, fn } of registeredListeners) window.removeEventListener(type, fn)
  registeredListeners.length = 0
  window.history.pushState({}, '', '/')
  vi.restoreAllMocks()
})

describe('DEBUGGER_TOUR definition', () => {
  it('declares the expected identity + i18n metadata', () => {
    expect(DEBUGGER_TOUR.id).toBe('debugger')
    expect(DEBUGGER_TOUR.version).toBe(1)
    expect(DEBUGGER_TOUR.titleKey).toBe('tour.tours.debugger.title')
    expect(DEBUGGER_TOUR.titleFallback).toBe('State machine debugger')
    expect(DEBUGGER_TOUR.descriptionKey).toBe('tour.tours.debugger.description')
    expect(DEBUGGER_TOUR.descriptionFallback).toContain('deep links')
  })

  it('stays launcher-only — no autoStart predicate (only the main tour opts in)', () => {
    expect(DEBUGGER_TOUR.autoStart).toBeUndefined()
  })

  it('is registered in the shared tour registry under its own id', () => {
    // Locks the wiring in tourRegistry.TOURS to this exact object.
    expect(getTour('debugger')).toBe(DEBUGGER_TOUR)
  })
})

describe('DEBUGGER_TOUR.steps', () => {
  it('walks through the four debugger panels in a fixed order', () => {
    expect(DEBUGGER_TOUR.steps).toHaveLength(4)
    expect(DEBUGGER_TOUR.steps.map((s) => s.target)).toEqual([
      '[data-tour="debugger-timeline"]',
      '[data-tour="debugger-source-badges"]',
      '[data-tour="debugger-controls"]',
      '[data-tour="debugger-share"]',
    ])
    expect(DEBUGGER_TOUR.steps.map((s) => s.placement)).toEqual([
      'bottom',
      'right',
      'top',
      'left',
    ])
  })

  it('every step is well-formed: non-empty copy + a valid placement', () => {
    for (const step of DEBUGGER_TOUR.steps) {
      expect(typeof step.title).toBe('string')
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(typeof step.description).toBe('string')
      expect(step.description.trim().length).toBeGreaterThan(0)
      expect(VALID_PLACEMENTS).toContain(step.placement)
    }
  })

  it('targets are unique, well-formed data-tour selectors', () => {
    const targets = DEBUGGER_TOUR.steps.map((s) => s.target)
    expect(new Set(targets).size).toBe(targets.length)
    for (const target of targets) {
      expect(target).toMatch(/^\[data-tour="debugger-[a-z-]+"\]$/)
    }
  })

  it('only the first step drives navigation; the rest are passive', () => {
    const [first, ...rest] = DEBUGGER_TOUR.steps
    expect(typeof first.onShow).toBe('function')
    for (const step of rest) {
      expect(step.onShow).toBeUndefined()
    }
    // No step wires an onHide teardown.
    for (const step of DEBUGGER_TOUR.steps) {
      expect(step.onHide).toBeUndefined()
    }
  })
})

describe('first step onShow navigation', () => {
  it('pushes the state-debugger route and notifies the router via popstate', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const onPopState = vi.fn()
    trackListener('popstate', onPopState)

    DEBUGGER_TOUR.steps[0].onShow!()

    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith({}, '', '/state-debugger')
    expect(window.location.pathname).toBe('/state-debugger')
    // The manual pushState is invisible to React Router without a popstate.
    expect(onPopState).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when already on the debugger route (no duplicate history entry)', () => {
    window.history.pushState({}, '', '/state-debugger')
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const onPopState = vi.fn()
    trackListener('popstate', onPopState)

    DEBUGGER_TOUR.steps[0].onShow!()

    expect(pushSpy).not.toHaveBeenCalled()
    expect(onPopState).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/state-debugger')
  })
})

describe('DEBUGGER_TOUR.routeMatch', () => {
  it('is a RegExp that matches every covered dev-tools route', () => {
    expect(DEBUGGER_TOUR.routeMatch).toBeInstanceOf(RegExp)
    for (const route of COVERED_ROUTES) {
      expect((DEBUGGER_TOUR.routeMatch as RegExp).test(route)).toBe(true)
    }
  })

  it('matches deep sub-paths of a covered route (prefix semantics)', () => {
    const re = DEBUGGER_TOUR.routeMatch as RegExp
    expect(re.test('/signal-log/detail/5')).toBe(true)
    expect(re.test('/live-monitor/anything')).toBe(true)
  })

  it('rejects unrelated app routes', () => {
    const re = DEBUGGER_TOUR.routeMatch as RegExp
    for (const route of ['/', '/dashboard', '/drives', '/charging', '/vehicles', '/settings']) {
      expect(re.test(route)).toBe(false)
    }
  })

  it('is anchored to the path root and requires the exact route stem', () => {
    const re = DEBUGGER_TOUR.routeMatch as RegExp
    // Mid-path occurrences must not match — the RegExp starts with ^\/.
    expect(re.test('/foo/state-debugger')).toBe(false)
    // The combined `/signals` workspace is deliberately NOT covered: every
    // stem is a hyphenated exact prefix, so `signals` never matches `signal-*`.
    expect(re.test('/signals')).toBe(false)
    expect(re.test('/state')).toBe(false)
  })

  it('drives isRecommendedForRoute through the shared registry helper', () => {
    expect(isRecommendedForRoute(DEBUGGER_TOUR, '/mqtt-inspector')).toBe(true)
    expect(isRecommendedForRoute(DEBUGGER_TOUR, '/redis-signals')).toBe(true)
    expect(isRecommendedForRoute(DEBUGGER_TOUR, '/dashboard')).toBe(false)
  })
})
