import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  TOURS,
  TOUR_ORDER,
  getTour,
  listTours,
  isTourCompleted,
  markTourCompleted,
  markTourSkipped,
  resetTour,
  resetAllTours,
  isRecommendedForRoute,
  getTourStatus,
} from '@/lib/tourRegistry'

describe('tour registry', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('exposes a non-empty TOURS map', () => {
    expect(Object.keys(TOURS).length).toBeGreaterThan(0)
  })

  it('TOUR_ORDER references every TOURS entry exactly once', () => {
    expect(TOUR_ORDER.length).toBe(Object.keys(TOURS).length)
    const tourIds = new Set(Object.keys(TOURS))
    const orderIds = new Set(TOUR_ORDER)
    for (const id of tourIds) expect(orderIds.has(id)).toBe(true)
    for (const id of orderIds) expect(tourIds.has(id)).toBe(true)
  })

  it('every tour has well-formed steps', () => {
    for (const def of listTours()) {
      expect(def.id).toBeTruthy()
      expect(def.titleKey).toBeTruthy()
      expect(def.descriptionKey).toBeTruthy()
      expect(typeof def.version).toBe('number')
      expect(def.version).toBeGreaterThan(0)
      expect(Array.isArray(def.steps)).toBe(true)
      expect(def.steps.length).toBeGreaterThan(0)
      for (const step of def.steps) {
        expect(typeof step.target).toBe('string')
        expect(step.target.length).toBeGreaterThan(0)
        expect(typeof step.title).toBe('string')
        expect(typeof step.description).toBe('string')
        expect(['top', 'bottom', 'left', 'right']).toContain(step.placement ?? 'bottom')
      }
    }
  })

  it('no tour declares an autoStart predicate — every tour is opt-in (HELP-01)', () => {
    // A tour that can start itself is a tour that can interrupt. Onboarding
    // that fires without being asked lives in `lib/onboardingTasks` instead:
    // one inline hint, on the relevant route, only while the task is
    // outstanding, and never for an experienced user.
    const withAutoStart = listTours().filter((t) => typeof t.autoStart === 'function')
    expect(withAutoStart).toHaveLength(0)
  })

  it('the main tour is reachable only through the launcher', () => {
    const main = getTour('main')!
    expect(main.autoStart).toBeUndefined()
    expect(isRecommendedForRoute(main, '/')).toBe(true)
  })

  it('storage round-trips completion status with version namespace', () => {
    expect(isTourCompleted('main', 1)).toBe(false)
    markTourCompleted('main', 1)
    expect(getTourStatus('main', 1)).toBe('completed')
    expect(isTourCompleted('main', 1)).toBe(true)
    // Version bump silently invalidates the previous flag.
    expect(isTourCompleted('main', 2)).toBe(false)
  })

  it('markTourSkipped persists a "skipped" status', () => {
    markTourSkipped('alerts', 1)
    expect(getTourStatus('alerts', 1)).toBe('skipped')
    expect(isTourCompleted('alerts', 1)).toBe(true)
  })

  it('resetTour clears every version of a single tour', () => {
    markTourCompleted('main', 1)
    markTourCompleted('main', 2)
    markTourCompleted('alerts', 1)
    resetTour('main')
    expect(getTourStatus('main', 1)).toBeNull()
    expect(getTourStatus('main', 2)).toBeNull()
    expect(getTourStatus('alerts', 1)).toBe('completed')
  })

  it('resetAllTours wipes every per-tour and the legacy global flag', () => {
    markTourCompleted('main', 1)
    markTourCompleted('alerts', 1)
    window.localStorage.setItem('teslasync-tour-completed', 'true')
    resetAllTours()
    expect(getTourStatus('main', 1)).toBeNull()
    expect(getTourStatus('alerts', 1)).toBeNull()
    expect(window.localStorage.getItem('teslasync-tour-completed')).toBeNull()
  })

  it('isRecommendedForRoute matches string prefixes and exact roots', () => {
    const def = { ...getTour('drives')!, routeMatch: '/drives' as const }
    expect(isRecommendedForRoute(def, '/drives')).toBe(true)
    expect(isRecommendedForRoute(def, '/drives/123')).toBe(true)
    expect(isRecommendedForRoute(def, '/charging')).toBe(false)
  })

  it('isRecommendedForRoute matches RegExp routeMatch entries', () => {
    const def = { ...getTour('drives')!, routeMatch: /^\/drives(?:\/.*)?$/ }
    expect(isRecommendedForRoute(def, '/drives')).toBe(true)
    expect(isRecommendedForRoute(def, '/drives/42')).toBe(true)
    expect(isRecommendedForRoute(def, '/vehicles')).toBe(false)
  })

  it('isRecommendedForRoute treats "/" as exact match only', () => {
    const def = { ...getTour('main')!, routeMatch: '/' as const }
    expect(isRecommendedForRoute(def, '/')).toBe(true)
    expect(isRecommendedForRoute(def, '/anything')).toBe(false)
  })
})
