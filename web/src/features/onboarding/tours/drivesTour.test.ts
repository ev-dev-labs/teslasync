import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DRIVES_TOUR } from './drivesTour'
import { getTour, isRecommendedForRoute, TOUR_ORDER, TOURS } from '@/lib/tourRegistry'

const PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

/** Push a path without emitting a popstate — mirrors a real router hop. */
function setPath(path: string) {
  window.history.pushState({}, '', path)
}

describe('DRIVES_TOUR definition', () => {
  it('exposes the drives identity and i18n metadata', () => {
    expect(DRIVES_TOUR.id).toBe('drives')
    expect(DRIVES_TOUR.titleKey).toBe('tour.tours.drives.title')
    expect(DRIVES_TOUR.titleFallback.length).toBeGreaterThan(0)
    expect(DRIVES_TOUR.descriptionKey).toBe('tour.tours.drives.description')
    expect(DRIVES_TOUR.descriptionFallback.length).toBeGreaterThan(0)
  })

  it('carries a positive integer version for completion-flag invalidation', () => {
    expect(typeof DRIVES_TOUR.version).toBe('number')
    expect(DRIVES_TOUR.version).toBeGreaterThan(0)
    expect(Number.isInteger(DRIVES_TOUR.version)).toBe(true)
  })

  it('is launcher-only — it must NOT declare an autoStart predicate', () => {
    // Contract: only the main tour auto-starts; every other tour stays
    // explicit so we never interrupt users who already know the app.
    expect(DRIVES_TOUR.autoStart).toBeUndefined()
  })

  it('is wired into the shared registry under the "drives" id and order', () => {
    expect(getTour('drives')).toBe(DRIVES_TOUR)
    expect(TOURS.drives).toBe(DRIVES_TOUR)
    expect(TOUR_ORDER).toContain('drives')
  })
})

describe('DRIVES_TOUR steps', () => {
  it('declares exactly four steps with unique data-tour selectors', () => {
    const targets = DRIVES_TOUR.steps.map((s) => s.target)
    expect(DRIVES_TOUR.steps).toHaveLength(4)
    for (const target of targets) {
      expect(target).toMatch(/^\[data-tour="[a-z-]+"\]$/)
    }
    // No two steps may spotlight the same element.
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('gives every step a non-empty title, description, and valid placement', () => {
    for (const step of DRIVES_TOUR.steps) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.description.length).toBeGreaterThan(0)
      expect(PLACEMENTS).toContain(step.placement)
    }
  })

  it('targets the exact anchors rendered by the drives + replay pages', () => {
    // These selectors must stay in lock-step with the data-tour attributes on
    // DrivesListPage and TripReplayPage — a typo here yields an empty spotlight.
    expect(DRIVES_TOUR.steps.map((s) => s.target)).toEqual([
      '[data-tour="drives-list"]',
      '[data-tour="drives-saved-views"]',
      '[data-tour="drive-replay-scrubber"]',
      '[data-tour="drive-replay-share"]',
    ])
  })

  it('only the first step drives navigation; later steps assume arrival', () => {
    expect(typeof DRIVES_TOUR.steps[0].onShow).toBe('function')
    expect(DRIVES_TOUR.steps[1].onShow).toBeUndefined()
    expect(DRIVES_TOUR.steps[2].onShow).toBeUndefined()
    expect(DRIVES_TOUR.steps[3].onShow).toBeUndefined()
  })
})

describe('DRIVES_TOUR routeMatch', () => {
  it('is recommended on the list, a drive detail, and a replay route', () => {
    expect(isRecommendedForRoute(DRIVES_TOUR, '/drives')).toBe(true)
    expect(isRecommendedForRoute(DRIVES_TOUR, '/drives/123')).toBe(true)
    expect(isRecommendedForRoute(DRIVES_TOUR, '/drives/123/replay')).toBe(true)
  })

  it('is NOT recommended on unrelated sections or the dashboard root', () => {
    expect(isRecommendedForRoute(DRIVES_TOUR, '/charging')).toBe(false)
    expect(isRecommendedForRoute(DRIVES_TOUR, '/vehicles')).toBe(false)
    expect(isRecommendedForRoute(DRIVES_TOUR, '/')).toBe(false)
  })

  it('anchors at the path start so a nested /x/drives does not match', () => {
    expect(isRecommendedForRoute(DRIVES_TOUR, '/vehicles/drives')).toBe(false)
  })
})

describe('DRIVES_TOUR first-step navigation (onShow → history)', () => {
  let popstate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setPath('/')
    popstate = vi.fn()
    window.addEventListener('popstate', popstate)
  })

  afterEach(() => {
    window.removeEventListener('popstate', popstate)
    setPath('/')
    vi.restoreAllMocks()
  })

  it('navigates to /drives and notifies the router when shown from elsewhere', () => {
    const push = vi.spyOn(window.history, 'pushState')

    DRIVES_TOUR.steps[0].onShow?.()

    expect(push).toHaveBeenCalledWith({}, '', '/drives')
    expect(window.location.pathname).toBe('/drives')
    // A single synthetic popstate re-renders the SPA router exactly once.
    expect(popstate).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when already on /drives (no duplicate history push)', () => {
    setPath('/drives')
    const push = vi.spyOn(window.history, 'pushState')

    DRIVES_TOUR.steps[0].onShow?.()

    expect(push).not.toHaveBeenCalled()
    expect(popstate).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/drives')
  })
})
