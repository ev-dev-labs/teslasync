import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { MAIN_TOUR } from './mainTour'
import type { TourAutoStartContext } from '@/lib/tourRegistry'
import { getTour, isRecommendedForRoute, listTours } from '@/lib/tourRegistry'
import { useTour } from '@/hooks/useTour'

const PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const

/** Pull the `data-tour` value out of a `[data-tour="…"]` attribute selector. */
function tourKey(selector: string): string | null {
  const match = selector.match(/^\[data-tour="([^"]+)"\]$/)
  return match ? match[1] : null
}

describe('MAIN_TOUR — identity & metadata', () => {
  it('is registered under the stable "main" id at the dashboard root', () => {
    expect(MAIN_TOUR.id).toBe('main')
    expect(MAIN_TOUR.routeMatch).toBe('/')
  })

  it('exposes i18n keys with human-readable English fallbacks', () => {
    expect(MAIN_TOUR.titleKey).toBe('tour.tours.main.title')
    expect(MAIN_TOUR.descriptionKey).toBe('tour.tours.main.description')
    expect(MAIN_TOUR.titleFallback).toBe('Welcome to TeslaSync')
    expect(MAIN_TOUR.descriptionFallback.length).toBeGreaterThan(0)
  })

  it('carries a positive integer version so completion flags can be invalidated', () => {
    expect(typeof MAIN_TOUR.version).toBe('number')
    expect(Number.isInteger(MAIN_TOUR.version)).toBe(true)
    expect(MAIN_TOUR.version).toBeGreaterThan(0)
    expect(MAIN_TOUR.version).toBe(2)
  })

  it('declares an autoStart predicate (the only tour that auto-launches)', () => {
    expect(typeof MAIN_TOUR.autoStart).toBe('function')
  })
})

describe('MAIN_TOUR — steps', () => {
  it('walks through a non-empty, ordered list of steps', () => {
    expect(Array.isArray(MAIN_TOUR.steps)).toBe(true)
    expect(MAIN_TOUR.steps.length).toBe(7)
  })

  it('gives every step a target, title, description and valid placement', () => {
    for (const step of MAIN_TOUR.steps) {
      expect(typeof step.target).toBe('string')
      expect(step.target.length).toBeGreaterThan(0)
      expect(step.title.trim().length).toBeGreaterThan(0)
      expect(step.description.trim().length).toBeGreaterThan(0)
      expect(PLACEMENTS).toContain(step.placement)
    }
  })

  it('uses unique `[data-tour="…"]` attribute selectors for every target', () => {
    const targets = MAIN_TOUR.steps.map((s) => s.target)
    // No duplicates — the spotlight would otherwise land on the same element twice.
    expect(new Set(targets).size).toBe(targets.length)
    for (const target of targets) {
      expect(tourKey(target)).not.toBeNull()
    }
  })

  it('opens on the sidebar and closes on the keyboard-shortcuts hint', () => {
    expect(MAIN_TOUR.steps[0]!.target).toBe('[data-tour="sidebar"]')
    expect(MAIN_TOUR.steps.at(-1)!.target).toBe('[data-tour="keyboard-hint"]')
  })

  it('stays on the dashboard root — no step navigates via onShow/onHide', () => {
    // The main tour is single-page: all targets live in the persistent Layout
    // shell or on the dashboard grid, so no cross-page navigation is needed.
    for (const step of MAIN_TOUR.steps) {
      expect(step.onShow).toBeUndefined()
      expect(step.onHide).toBeUndefined()
    }
  })
})

describe('MAIN_TOUR — targets resolve through document.querySelector', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds a matching element for every step target (mirrors useTour)', () => {
    // Reproduce how `useTour` locates a step: document.querySelector(step.target).
    document.body.innerHTML = MAIN_TOUR.steps
      .map((s) => `<div data-tour="${tourKey(s.target)}">x</div>`)
      .join('')

    for (const step of MAIN_TOUR.steps) {
      const el = document.querySelector(step.target)
      expect(el).not.toBeNull()
      expect(el).toBeInstanceOf(HTMLElement)
    }
  })

  it('returns null (never throws) when the target is absent from the DOM', () => {
    // jsdom starts empty here — the selector must still be syntactically valid.
    expect(() => document.querySelector(MAIN_TOUR.steps[0]!.target)).not.toThrow()
    expect(document.querySelector(MAIN_TOUR.steps[0]!.target)).toBeNull()
  })
})

describe('MAIN_TOUR.autoStart — predicate branches', () => {
  const autoStart = MAIN_TOUR.autoStart!

  it('starts on the dashboard root when at least one vehicle is linked', () => {
    expect(autoStart({ pathname: '/', vehicleCount: 1 })).toBe(true)
    expect(autoStart({ pathname: '/', vehicleCount: 12 })).toBe(true)
  })

  it('does not start when the fleet is empty', () => {
    expect(autoStart({ pathname: '/', vehicleCount: 0 })).toBe(false)
  })

  it('does not start for a negative (corrupt) vehicle count', () => {
    expect(autoStart({ pathname: '/', vehicleCount: -3 })).toBe(false)
  })

  it('only matches the exact root — not a nested or "/dashboard" path', () => {
    expect(autoStart({ pathname: '/vehicles', vehicleCount: 4 })).toBe(false)
    expect(autoStart({ pathname: '/dashboard', vehicleCount: 4 })).toBe(false)
    expect(autoStart({ pathname: '', vehicleCount: 2 })).toBe(false)
  })

  it('is null-safe: a partial context missing vehicleCount resolves to false', () => {
    expect(autoStart({ pathname: '/' } as unknown as TourAutoStartContext)).toBe(false)
  })

  it('is null-safe: an undefined context returns false without throwing', () => {
    expect(() => autoStart(undefined as unknown as TourAutoStartContext)).not.toThrow()
    expect(autoStart(undefined as unknown as TourAutoStartContext)).toBe(false)
  })
})

describe('MAIN_TOUR — registry integration', () => {
  it('is the exact definition the registry resolves for "main"', () => {
    expect(getTour('main')).toBe(MAIN_TOUR)
  })

  it('is the sole tour that opts into auto-start', () => {
    const autoStarting = listTours().filter((t) => typeof t.autoStart === 'function')
    expect(autoStarting).toHaveLength(1)
    expect(autoStarting[0]).toBe(MAIN_TOUR)
  })

  it('is recommended only on the exact root route', () => {
    expect(isRecommendedForRoute(MAIN_TOUR, '/')).toBe(true)
    expect(isRecommendedForRoute(MAIN_TOUR, '/vehicles')).toBe(false)
  })
})

describe('MAIN_TOUR — driven through the useTour engine', () => {
  it('reports the full step count and starts inactive', () => {
    const { result } = renderHook(() => useTour(MAIN_TOUR.steps))
    expect(result.current.totalSteps).toBe(MAIN_TOUR.steps.length)
    expect(result.current.isActive).toBe(false)
    expect(result.current.step).toBeNull()
    expect(result.current.currentStep).toBe(0)
  })

  it('activates on start() and surfaces the first step', () => {
    const { result } = renderHook(() => useTour(MAIN_TOUR.steps))
    act(() => result.current.start())
    expect(result.current.isActive).toBe(true)
    expect(result.current.step).toEqual(MAIN_TOUR.steps[0])
    expect(result.current.currentStep).toBe(0)
  })

  it('advances with next() and rewinds with prev(), clamped at the start', () => {
    const { result } = renderHook(() => useTour(MAIN_TOUR.steps))
    act(() => result.current.start())
    act(() => result.current.next())
    expect(result.current.currentStep).toBe(1)
    expect(result.current.step).toEqual(MAIN_TOUR.steps[1])

    act(() => result.current.prev())
    expect(result.current.currentStep).toBe(0)
    // prev() at the first step is a no-op, never a negative index.
    act(() => result.current.prev())
    expect(result.current.currentStep).toBe(0)
  })

  it('finishes the tour after advancing past the last step', () => {
    const { result } = renderHook(() => useTour(MAIN_TOUR.steps))
    act(() => result.current.start())
    // One next() per step drives currentStep to the end, then deactivates.
    for (let i = 0; i < MAIN_TOUR.steps.length; i++) {
      act(() => result.current.next())
    }
    expect(result.current.isActive).toBe(false)
    expect(result.current.step).toBeNull()
  })

  it('skip() closes the tour immediately from any step', () => {
    const { result } = renderHook(() => useTour(MAIN_TOUR.steps))
    act(() => result.current.start())
    act(() => result.current.next())
    act(() => result.current.skip())
    expect(result.current.isActive).toBe(false)
    expect(result.current.step).toBeNull()
  })
})
