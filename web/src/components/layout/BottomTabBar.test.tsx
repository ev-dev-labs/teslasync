/**
 * BottomTabBar behaviour tests.
 *
 * BottomTabBar is the mobile-only (`< lg`) bottom navigation for the five
 * most-trafficked routes (Dashboard / Drives / Charging / Battery / Map). It
 * renders one <PrefetchLink> per tab inside a navigation landmark, computes an
 * active state from the current pathname, and exposes the tab paths as the
 * `BOTTOM_TAB_PATHS` set so the sidebar can de-emphasise duplicates on mobile.
 *
 * These tests exercise multiple facets rather than a smoke render:
 *   1. The navigation landmark + its translated accessible label.
 *   2. The full, order-stable set of tab links and their routes/labels.
 *   3. i18n wiring — the exact (key, English-fallback) pairs for every string.
 *   4. Active-state logic across the tricky branches:
 *        - "/" is EXACT-match only (never lit on a sub-route),
 *        - a tab lights on its exact route,
 *        - a tab lights on a NESTED child route (`startsWith(path + '/')`),
 *        - a sibling route sharing a prefix (`/charging-curve`) does NOT light
 *          the `/charging` tab (the boundary bug this logic guards against).
 *   5. a11y — the decorative glyph is `aria-hidden` (excluded from the a11y
 *      tree) and no unlabelled `img` role leaks to screen readers; every tab is
 *      a native, focusable anchor with a WCAG 2.5.5 touch target.
 *   6. The active underline indicator renders only for the active tab.
 *   7. Route prefetch is wired: hovering a tab prefetches its lazy chunk.
 *   8. The `BOTTOM_TAB_PATHS` export is the exact set of destinations.
 *
 * react-i18next is stubbed with a passthrough `t(key, fallback)` spy (the same
 * convention as QuickNav.test.tsx) so the DOM shows English defaults AND we can
 * assert on the exact (key, fallback) pairs. `@/lib/routePrefetch` is mocked so
 * hover never triggers a real dynamic import (matching PrefetchLink.test.tsx).
 * A <MemoryRouter> supplies the router context the links need. No network is
 * touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { tSpy } = vi.hoisted(() => ({ tSpy: vi.fn() }))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return { ...actual, useTranslation: () => ({ t: tSpy }) }
})

vi.mock('@/lib/routePrefetch', () => ({ prefetchRoute: vi.fn() }))

import { BottomTabBar, BOTTOM_TAB_PATHS } from './BottomTabBar'
import { prefetchRoute } from '@/lib/routePrefetch'

const mockedPrefetch = vi.mocked(prefetchRoute)

// Declared order of TABS — the rendered link order is deterministic, so the
// index-based assertions below are stable.
const TABS = [
  { path: '/', label: 'Home', key: 'nav.dashboard' },
  { path: '/drives', label: 'Drives', key: 'nav.drives' },
  { path: '/charging', label: 'Charging', key: 'nav.charging' },
  { path: '/battery', label: 'Battery', key: 'nav.battery' },
  { path: '/live', label: 'Map', key: 'nav.liveMap' },
] as const

function renderBar(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <BottomTabBar />
    </MemoryRouter>,
  )
}

function indicatorsWithin(el: HTMLElement): HTMLElement[] {
  // The active underline is the theme-primary pill span. Filter by className
  // rather than a CSS selector to avoid escaping the `[var(--…)]` arbitrary
  // value in querySelector.
  return Array.from(el.querySelectorAll('span')).filter((s) =>
    s.className.includes('bg-[var(--theme-primary)]'),
  )
}

beforeEach(() => {
  cleanup()
  // Passthrough: return the English fallback so the DOM shows real copy, while
  // still letting us assert on the (key, fallback) pairs the component passes.
  tSpy.mockReset()
  tSpy.mockImplementation((_key: string, fallback?: string) => fallback ?? _key)
  mockedPrefetch.mockClear()
})

describe('BottomTabBar', () => {
  it('renders a navigation landmark with an accessible, translated label', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(nav).toBeInTheDocument()
    expect(tSpy).toHaveBeenCalledWith('nav.quickNav', 'Quick navigation')
  })

  it('renders exactly one link per tab in declared order with correct hrefs', () => {
    renderBar()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(TABS.length)
    TABS.forEach((tab, i) => {
      expect(links[i]).toHaveAttribute('href', tab.path)
    })
  })

  it('labels every tab via i18n with an English fallback (aria-label + caption)', () => {
    renderBar()
    for (const tab of TABS) {
      // The component passes each tab's (i18nKey, fallback) to t().
      expect(tSpy).toHaveBeenCalledWith(tab.key, tab.label)
      // aria-label is the accessible name; getByRole(name) proves it resolved.
      expect(screen.getByRole('link', { name: tab.label })).toBeInTheDocument()
    }
  })

  it('marks the Home tab active (aria-current="page") on the exact root route', () => {
    renderBar('/')
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Exactly one tab may be current at a time.
    for (const tab of TABS.filter((t) => t.path !== '/')) {
      expect(
        screen.getByRole('link', { name: tab.label }),
      ).not.toHaveAttribute('aria-current')
    }
  })

  it('never lights the Home tab on a non-root route ("/" is exact-match only)', () => {
    renderBar('/drives')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: 'Drives' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('lights a tab on its exact route', () => {
    renderBar('/charging')
    expect(screen.getByRole('link', { name: 'Charging' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('lights a tab on a nested child route (startsWith path + "/")', () => {
    renderBar('/charging/42')
    expect(screen.getByRole('link', { name: 'Charging' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // No sibling tab is falsely activated by the nested route.
    expect(screen.getByRole('link', { name: 'Battery' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('does NOT light a tab for a sibling route sharing its prefix (boundary guard)', () => {
    // "/charging-curve" must not activate the "/charging" tab — the reason the
    // active check uses `startsWith(path + '/')` and not a bare `startsWith`.
    renderBar('/charging-curve')
    expect(screen.getByRole('link', { name: 'Charging' })).not.toHaveAttribute(
      'aria-current',
    )
    // An off-bar route activates no tab at all.
    screen.getAllByRole('link').forEach((link) => {
      expect(link).not.toHaveAttribute('aria-current')
    })
  })

  it('marks each tab glyph decorative (aria-hidden) and leaks no img role', () => {
    renderBar()
    const links = screen.getAllByRole('link')
    links.forEach((link) => {
      // One decorative icon per tab; the meaning is carried by the aria-label.
      expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    })
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders the active underline indicator only on the active tab', () => {
    renderBar('/drives')
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    // Exactly one underline across the whole bar.
    expect(indicatorsWithin(nav)).toHaveLength(1)
    // ...and it belongs to the active tab.
    expect(
      indicatorsWithin(screen.getByRole('link', { name: 'Drives' })),
    ).toHaveLength(1)
    expect(
      indicatorsWithin(screen.getByRole('link', { name: 'Charging' })),
    ).toHaveLength(0)
  })

  it('shows no underline indicator when the route is off the bar', () => {
    renderBar('/settings')
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(indicatorsWithin(nav)).toHaveLength(0)
  })

  it('prefetches a tab route on hover (wires PrefetchLink `to`)', () => {
    renderBar('/')
    expect(mockedPrefetch).not.toHaveBeenCalled()
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Charging' }))
    expect(mockedPrefetch).toHaveBeenCalledWith('/charging')
  })

  it('renders tabs as native, focusable anchors (keyboard operable)', () => {
    renderBar()
    const first = screen.getByRole('link', { name: 'Home' })
    expect(first.tagName).toBe('A')
    first.focus()
    expect(first).toHaveFocus()
  })

  it('is a mobile-only bar with iOS safe-area padding and ≥44px touch targets', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(nav.className).toContain('xl:hidden')
    expect(nav.className).toContain('safe-bottom')
    screen.getAllByRole('link').forEach((link) => {
      expect(link.className).toContain('min-h-[44px]')
      expect(link.className).toContain('min-w-[48px]')
    })
  })
})

describe('BOTTOM_TAB_PATHS', () => {
  it('is the exact set of the five bottom-tab destinations', () => {
    expect(BOTTOM_TAB_PATHS).toBeInstanceOf(Set)
    expect(BOTTOM_TAB_PATHS.size).toBe(TABS.length)
    for (const tab of TABS) {
      expect(BOTTOM_TAB_PATHS.has(tab.path)).toBe(true)
    }
  })

  it('excludes routes that are not rendered on the bottom bar', () => {
    expect(BOTTOM_TAB_PATHS.has('/settings')).toBe(false)
    expect(BOTTOM_TAB_PATHS.has('/charging-curve')).toBe(false)
  })
})
