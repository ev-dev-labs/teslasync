/**
 * QuickLinksSection unit tests.
 *
 * QuickLinksSection is the static quick-navigation cluster on the
 * vehicle-detail page: a titled GlassPanel wrapping a `<nav>` landmark of six
 * route cards (Drives, Charging, Battery, Climate, Efficiency, Settings). It
 * takes no props and fetches no data, so the surface under test is entirely
 * structural + navigational: the right labels resolve to the right in-app
 * routes, the region is a single labelled landmark, every card is a keyboard-
 * operable anchor with a visible focus ring, and the decorative icons stay out
 * of the accessibility tree.
 *
 * `react-i18next` is stubbed to echo each key's inline English fallback (the
 * production default when no translation row exists), so the visible labels are
 * the fallbacks and the i18n keys are exercised without a raw key leaking into
 * the UI. `Link` needs Router context, so every render is wrapped in a
 * MemoryRouter; the navigation case mounts real sibling Routes and clicks
 * through to prove a card actually resolves its target route.
 *
 * Coverage:
 *   1. The "Quick Links" panel heading renders (real heading element).
 *   2. The cards live in exactly one navigation landmark named "Quick Links".
 *   3. Exactly six cards render — one per known route.
 *   4. Every label maps to its canonical in-app route (dead-link guard).
 *   5. The destinations render in the documented order.
 *   6. Every decorative icon is aria-hidden (none exposed to a11y tree).
 *   7. Each card carries the keyboard-visible focus-ring utility.
 *   8. Cards are native anchors and are focusable (keyboard operability).
 *   9. Activating a card navigates to its target route.
 *  10. Labels come from the i18n fallbacks — no raw translation key leaks.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { QuickLinksSection } from './QuickLinksSection'

/** The canonical label → route contract every card must honour, in order. */
const LINKS = [
  { label: 'Drives', to: '/drives' },
  { label: 'Charging', to: '/charging' },
  { label: 'Battery', to: '/battery' },
  { label: 'Climate', to: '/climate' },
  { label: 'Efficiency', to: '/efficiency' },
  { label: 'Settings', to: '/settings' },
] as const

function renderSection() {
  return render(
    <MemoryRouter>
      <QuickLinksSection />
    </MemoryRouter>,
  )
}

describe('QuickLinksSection — structure', () => {
  it('renders the "Quick Links" panel heading', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: 'Quick Links' })).toBeInTheDocument()
  })

  it('exposes a single navigation landmark named "Quick Links" that holds every card', () => {
    renderSection()

    const navs = screen.getAllByRole('navigation', { name: 'Quick Links' })
    expect(navs).toHaveLength(1)
    // Every card link lives inside that landmark.
    expect(within(navs[0]).getAllByRole('link')).toHaveLength(LINKS.length)
  })

  it('renders exactly six cards — one per known route', () => {
    renderSection()
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })
})

describe('QuickLinksSection — label → route contract', () => {
  it('points each label at its canonical in-app route', () => {
    renderSection()
    for (const { label, to } of LINKS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', to)
    }
  })

  it('renders the destinations in the documented order', () => {
    renderSection()
    const names = screen.getAllByRole('link').map((a) => a.textContent?.trim())
    expect(names).toEqual(LINKS.map((l) => l.label))
  })
})

describe('QuickLinksSection — accessibility', () => {
  it('keeps every decorative icon out of the accessibility tree', () => {
    const { container } = renderSection()
    // Heading chevron + six card icons = seven purely-decorative SVGs, and the
    // adjacent text carries the meaning, so none should be exposed.
    expect(
      container.querySelectorAll('svg[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(7)
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0)
  })

  it('gives every card link a keyboard-visible focus ring', () => {
    renderSection()
    for (const { label } of LINKS) {
      expect(screen.getByRole('link', { name: label }).className).toContain(
        'focus-visible:ring-2',
      )
    }
  })

  it('renders cards as native, focusable anchors so they are keyboard operable', () => {
    renderSection()
    const drives = screen.getByRole('link', { name: 'Drives' })
    expect(drives.tagName).toBe('A')
    // A real href makes the anchor focusable + Enter-activatable natively.
    expect(drives).toHaveAttribute('href', '/drives')
    drives.focus()
    expect(drives).toHaveFocus()
  })
})

describe('QuickLinksSection — navigation & i18n', () => {
  it('navigates to the target route when a card is activated', () => {
    render(
      <MemoryRouter initialEntries={['/vehicles/1']}>
        <Routes>
          <Route path="/vehicles/1" element={<QuickLinksSection />} />
          <Route path="/charging" element={<div>Charging Destination</div>} />
        </Routes>
      </MemoryRouter>,
    )

    // We start on the vehicle-detail route, not the charging destination.
    expect(screen.queryByText('Charging Destination')).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Charging' }))

    expect(screen.getByText('Charging Destination')).toBeInTheDocument()
  })

  it('renders labels from the i18n fallbacks — no raw translation key leaks', () => {
    renderSection()
    // The English fallbacks render for the label AND the landmark name…
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Quick Links' })).toBeInTheDocument()
    // …and the underlying i18n keys never leak into the UI.
    expect(screen.queryByText('nav.settings')).toBeNull()
    expect(screen.queryByText('vehicles.detail.quickLinks')).toBeNull()
  })
})
