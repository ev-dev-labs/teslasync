/**
 * QuickNav tests.
 *
 * QuickNav is a static, prop-less shortcut grid on the dashboard. It renders
 * four `react-router-dom` <Link>s (Drives / Charging / Analytics / Battery)
 * inside a navigation landmark, each with a decorative accent icon, a
 * decorative chevron, and i18n label/description copy.
 *
 * The tests exercise multiple facets rather than a smoke render:
 *   1. The navigation landmark + its accessible label.
 *   2. The full set of links, their routes (order-stable), and visible copy.
 *   3. i18n wiring — the exact (key, English-fallback) pairs for every string.
 *   4. a11y — decorative icons are aria-hidden (excluded from the a11y tree),
 *      no unlabelled `img` role leaks to screen readers.
 *   5. Per-item accent color applied via the dynamic inline style.
 *   6. Keyboard operability — links are native, focusable anchors.
 *   7. The export is a memoised component (perf hardening) with a displayName.
 *
 * react-i18next is stubbed with a passthrough `t(key, fallback)` spy so the component renders English
 * defaults without the full i18n bootstrap AND we can assert on the exact
 * (key, fallback) pairs. A <MemoryRouter> supplies the router context the
 * <Link>s need. No network is touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { tSpy } = vi.hoisted(() => ({ tSpy: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tSpy }),
}))

import { QuickNav } from './QuickNav'

// The declared order of NAV_ITEMS — the rendered link order is deterministic,
// so index-based assertions below are stable.
const EXPECTED = [
  {
    href: '/drives',
    label: 'Drives',
    labelKey: 'nav.drives',
    desc: 'Trip history',
    descKey: 'nav.drivesDesc',
    color: '#00f0ff',
  },
  {
    href: '/charging',
    label: 'Charging',
    labelKey: 'nav.charging',
    desc: 'Sessions & costs',
    descKey: 'nav.chargingDesc',
    color: '#10b981',
  },
  {
    href: '/analytics',
    label: 'Analytics',
    labelKey: 'nav.analytics',
    desc: 'Fleet insights',
    descKey: 'nav.analyticsDesc',
    color: '#a855f7',
  },
  {
    href: '/battery',
    label: 'Battery',
    labelKey: 'nav.battery',
    desc: 'Health & degradation',
    descKey: 'nav.batteryDesc',
    color: '#f59e0b',
  },
] as const

function renderNav() {
  return render(
    <MemoryRouter>
      <QuickNav />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Passthrough: return the English fallback so the DOM shows real copy, while
  // still letting us assert on the (key, fallback) pairs the component passes.
  tSpy.mockReset()
  tSpy.mockImplementation((_key: string, fallback?: string) => fallback ?? _key)
})

describe('QuickNav', () => {
  it('renders a navigation landmark with an accessible, translated label', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(nav).toBeInTheDocument()
    expect(tSpy).toHaveBeenCalledWith('quickNav.label', 'Quick navigation')
  })

  it('renders exactly one link per nav item, each pointing at the right route', () => {
    renderNav()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(EXPECTED.length)
    EXPECTED.forEach((item, i) => {
      expect(links[i]).toHaveAttribute('href', item.href)
    })
  })

  it('shows the label and description copy for every item', () => {
    renderNav()
    for (const item of EXPECTED) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
      expect(screen.getByText(item.desc)).toBeInTheDocument()
    }
  })

  it('wires every label and description through i18n with an English fallback', () => {
    renderNav()
    for (const item of EXPECTED) {
      expect(tSpy).toHaveBeenCalledWith(item.labelKey, item.label)
      expect(tSpy).toHaveBeenCalledWith(item.descKey, item.desc)
    }
  })

  it('marks the accent icon and chevron of every link as decorative (aria-hidden)', () => {
    renderNav()
    // Two decorative SVGs per link (leading accent glyph + trailing chevron).
    const hiddenIcons = document.querySelectorAll('svg[aria-hidden="true"]')
    expect(hiddenIcons).toHaveLength(EXPECTED.length * 2)

    const links = screen.getAllByRole('link')
    links.forEach((link) => {
      expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
      // The visible copy — not the icons — carries the meaning.
      expect(link).toHaveTextContent(/[A-Za-z]/)
    })
  })

  it('exposes no unlabelled image role to screen readers', () => {
    renderNav()
    // Decorative icons are aria-hidden, so nothing surfaces as an `img`.
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('applies each item accent color to its leading icon via the dynamic inline style', () => {
    renderNav()
    const links = screen.getAllByRole('link')
    EXPECTED.forEach((item, i) => {
      // First aria-hidden svg in DOM order is the leading accent icon; the
      // chevron gets its color from a CSS-var class, not an inline style.
      const icon = links[i].querySelector<SVGSVGElement>('svg[aria-hidden="true"]')
      expect(icon).not.toBeNull()
      expect(icon!).toHaveStyle({ color: item.color })
    })
  })

  it('renders links as native, focusable anchors (keyboard operable)', () => {
    renderNav()
    const first = screen.getByRole('link', { name: /Drives/i })
    expect(first.tagName).toBe('A')
    expect(first).toHaveAttribute('href', '/drives')

    // Anchors with an href are natively focusable / in the tab order.
    first.focus()
    expect(first).toHaveFocus()
    // A user click stays within the router (no crash / navigation error).
    fireEvent.click(first)
    expect(first).toHaveAttribute('href', '/drives')
  })

  it('is exported as a memoised component with a stable displayName', () => {
    // memo(...) returns an exotic component object (not a plain function);
    // this documents the perf hardening on a hot dashboard re-render surface.
    expect(typeof QuickNav).toBe('object')
    expect((QuickNav as { displayName?: string }).displayName).toBe('QuickNav')
  })
})
