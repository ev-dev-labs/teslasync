/**
 * RecentlyViewedWidget tests.
 *
 * The widget is a thin presentation layer on top of `lib/recentPages`,
 * so the tests focus on:
 *   1. Empty-state rendering when nothing is in the store.
 *   2. Top-N ordering: most-recent entry first.
 *   3. Live updates via `subscribeRecentPages` after the widget mounts.
 *   4. Graceful handling of unknown kinds (icon fallback).
 *
 * We rely on the lib's own test seam (`__resetRecentPagesForTests`) so
 * the localStorage namespace is clean per test, and use a wrapping
 * `<MemoryRouter>` because the widget renders `react-router-dom`'s
 * `<Link>` for each row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RecentlyViewedWidget } from './RecentlyViewedWidget'
import {
  __resetRecentPagesForTests,
  recordPageView,
} from '@/lib/recentPages'

// react-i18next stub — passthrough `t(key, default)` so the widget renders
// English defaults without needing the full i18n bootstrap.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | object) => {
      if (typeof defaultValue === 'string') return defaultValue
      return key
    },
  }),
}))

function renderWidget() {
  return render(
    <MemoryRouter>
      <RecentlyViewedWidget />
    </MemoryRouter>,
  )
}

describe('RecentlyViewedWidget', () => {
  beforeEach(() => {
    __resetRecentPagesForTests()
  })

  afterEach(() => {
    __resetRecentPagesForTests()
  })

  it('renders the empty state when no pages have been visited', () => {
    renderWidget()
    expect(screen.getByTestId('recently-viewed-widget')).toBeInTheDocument()
    expect(screen.getByTestId('recently-viewed-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('recently-viewed-list')).not.toBeInTheDocument()
  })

  it('renders rows for recorded pages with most-recent first', () => {
    recordPageView({ path: '/vehicles/1', title: 'Model 3', kind: 'vehicle' })
    recordPageView({ path: '/drives/42', title: 'Drive 42', kind: 'drive' })
    recordPageView({ path: '/charging/7', title: 'Charge 7', kind: 'charging' })

    renderWidget()
    const list = screen.getByTestId('recently-viewed-list')
    expect(list).toBeInTheDocument()

    const items = list.querySelectorAll('li')
    expect(items.length).toBe(3)
    // Most-recent push (charging) is at the top.
    expect(items[0].textContent).toContain('Charge 7')
    expect(items[1].textContent).toContain('Drive 42')
    expect(items[2].textContent).toContain('Model 3')
  })

  it('caps the visible list at the configured limit', () => {
    for (let i = 0; i < 12; i++) {
      recordPageView({
        path: `/vehicles/${i}`,
        title: `Vehicle ${i}`,
        kind: 'vehicle',
      })
    }

    renderWidget()
    const items = screen
      .getByTestId('recently-viewed-list')
      .querySelectorAll('li')
    // Default visible cap is 5.
    expect(items.length).toBe(5)
  })

  it('updates live when a new page is recorded after mount', () => {
    renderWidget()
    expect(screen.getByTestId('recently-viewed-empty')).toBeInTheDocument()

    act(() => {
      recordPageView({ path: '/drives/99', title: 'Late Drive', kind: 'drive' })
    })

    expect(screen.queryByTestId('recently-viewed-empty')).not.toBeInTheDocument()
    expect(screen.getByText('Late Drive')).toBeInTheDocument()
  })

  it('renders a Link with the correct href for each row', () => {
    recordPageView({ path: '/drives/55', title: 'Drive 55', kind: 'drive' })
    renderWidget()
    const link = screen.getByTestId('recently-viewed-row-/drives/55')
    expect(link.getAttribute('href')).toBe('/drives/55')
  })

  it('falls back to a generic icon for unknown page kinds', () => {
    recordPageView({ path: '/system', title: 'System', kind: 'page' })
    renderWidget()
    // Just assert the row renders — fallback branch is exercised.
    expect(
      screen.getByTestId('recently-viewed-row-/system'),
    ).toBeInTheDocument()
  })
})
