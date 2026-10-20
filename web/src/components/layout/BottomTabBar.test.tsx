/**
 * BottomTabBar behaviour tests.
 *
 * BottomTabBar is the phone-only bottom navigation owned by the CommandDeck:
 * four primary section tabs (Home / Vehicles / Driving / Charging) plus a
 * More tab that opens the deck's section sheet. It renders one native
 * <button> per tab inside a navigation landmark, derives its selected state
 * from the `activeSection` prop (exact section-title equality, with More as
 * the fallback for any section without a primary tab), and reports taps
 * through `onChoose` (a section title, or null for More). Phone-only display
 * is CSS-driven (`sidenav-phone-tabs` hides at >=768px) and the deck mounts
 * the bar only on phone viewports. The `BOTTOM_TAB_PATHS` export is the set
 * of tab destinations so the sidebar can de-emphasise duplicates on mobile.
 *
 * These tests exercise multiple facets rather than a smoke render:
 *   1. The navigation landmark + its translated accessible label.
 *   2. The full, order-stable set of tab buttons and their labels.
 *   3. i18n wiring — the exact (key, English-fallback) pairs for every string.
 *   4. Selection logic across the tricky branches:
 *        - Home is selected by default,
 *        - a tab is selected on its exact section title,
 *        - More is selected for ANY section without a primary tab,
 *        - a similarly-named section (`Charging curve`) does NOT select the
 *          `Charging` tab (the exact-equality guard).
 *   5. a11y — the decorative glyph is `aria-hidden` (excluded from the a11y
 *      tree) and no unlabelled `img` role leaks to screen readers; every tab is
 *      a native, focusable button with a WCAG 2.5.5 touch target.
 *   6. The selected-state marker renders only for the active tab.
 *   7. Tap activation is wired: pressing a tab reports its section via
 *      `onChoose` (null for More).
 *   8. Theme surfaces keep inactive text readable and the selected state
 *      distinguishable without relying on color alone.
 *   9. The `BOTTOM_TAB_PATHS` export is the exact set of destinations.
 *
 * react-i18next is stubbed with a passthrough `t(key, fallback)` spy (the same
 * convention as QuickNav.test.tsx) so the DOM shows English defaults AND we can
 * assert on the exact (key, fallback) pairs. The real Button is used so focus,
 * keyboard activation and touch-target classes are genuine. No network is
 * touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { navSections } from './Layout'
import { navRouteIcons } from '@/lib/navRouteIcons'
import { SIDEBAR_ROUTE_ICONS } from './sidebar/sidebarIcons'

const { tSpy } = vi.hoisted(() => ({ tSpy: vi.fn() }))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return { ...actual, useTranslation: () => ({ t: tSpy }) }
})

import { BottomTabBar, BOTTOM_TAB_PATHS } from './BottomTabBar'

// Declared tab order — the rendered button order is deterministic, so the
// index-based assertions below are stable. `section: null` is the More tab,
// which opens the deck sheet instead of selecting a section.
const TABS = [
  { section: 'Home', label: 'Home', key: 'nav.mobileHome' },
  { section: 'Vehicles', label: 'Vehicles', key: 'nav.sidenav.mobileVehicles' },
  { section: 'Driving', label: 'Driving', key: 'nav.sidenav.mobileDriving' },
  { section: 'Charging', label: 'Charging', key: 'nav.mobileCharging' },
  { section: null, label: 'More', key: 'nav.mobileMore' },
] as const

// The destinations the tabs stand for (used by the sidebar to de-emphasise
// duplicates on mobile). Note the Driving tab stands for /drives and More
// stands for the /explore catalogue.
const TAB_PATHS = ['/', '/vehicles', '/drives', '/charging', '/explore'] as const

function renderBar(activeSection?: string) {
  const onChoose = vi.fn()
  const result = render(
    <BottomTabBar activeSection={activeSection} onChoose={onChoose} />,
  )
  return { ...result, onChoose }
}

function selectedWithin(el: HTMLElement): HTMLElement[] {
  // The selected marker is the `is-selected` class (drives the ::before
  // position bar in sidenav.css alongside `aria-current`). Filter by
  // className rather than a CSS selector to keep the query exact.
  return Array.from(el.querySelectorAll('button')).filter((b) =>
    b.className.includes('is-selected'),
  )
}

beforeEach(() => {
  cleanup()
  // Passthrough: return the English fallback so the DOM shows real copy, while
  // still letting us assert on the (key, fallback) pairs the component passes.
  tSpy.mockReset()
  tSpy.mockImplementation((_key: string, fallback?: string) => fallback ?? _key)
})

describe('BottomTabBar', () => {
  it('renders a navigation landmark with an accessible, translated label', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(nav).toBeInTheDocument()
    expect(nav).toHaveAttribute('data-role', 'bottom-tab-bar')
    expect(nav.className).toContain('sidenav-phone-tabs')
    expect(tSpy).toHaveBeenCalledWith('nav.quickNav', 'Quick navigation')
  })

  it('renders exactly one button per tab in declared order with correct labels', () => {
    renderBar()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(TABS.length)
    TABS.forEach((tab, i) => {
      expect(buttons[i]).toHaveAccessibleName(tab.label)
      expect(buttons[i]).toHaveTextContent(tab.label)
    })
    // Button-based by design: no link roles leak from the tab bar.
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('labels every tab via i18n with an English fallback (aria-label + caption)', () => {
    renderBar()
    for (const tab of TABS) {
      // The component passes each tab's (i18nKey, fallback) to t().
      expect(tSpy).toHaveBeenCalledWith(tab.key, tab.label)
      // aria-label is the accessible name; getByRole(name) proves it resolved.
      const button = screen.getByRole('button', { name: tab.label })
      expect(button).toBeInTheDocument()
      expect(button.querySelector('.sidenav-tab-label')).toHaveTextContent(tab.label)
    }
  })

  it('marks the Home tab selected (aria-current="true") by default', () => {
    renderBar()
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    // Exactly one tab may be selected at a time.
    for (const tab of TABS.filter((t) => t.label !== 'Home')) {
      expect(
        screen.getByRole('button', { name: tab.label }),
      ).not.toHaveAttribute('aria-current')
    }
  })

  it('never lights the Home tab when another section is active (exact-match only)', () => {
    renderBar('Driving')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('button', { name: 'Driving' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('lights a tab on its exact section', () => {
    renderBar('Charging')
    expect(screen.getByRole('button', { name: 'Charging' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('lights the More tab when the active section has no primary tab', () => {
    renderBar('Battery')
    const more = screen.getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-current', 'true')
    expect(more).toHaveClass('is-selected')
    // No primary tab is falsely activated by the off-bar section.
    for (const tab of TABS.filter((t) => t.section !== null)) {
      expect(
        screen.getByRole('button', { name: tab.label }),
      ).not.toHaveAttribute('aria-current')
    }
  })

  it('lights More for any off-bar section (fallback, not a prefix match)', () => {
    renderBar('Reports')
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    // No sibling tab is falsely activated by the off-bar section.
    expect(screen.getByRole('button', { name: 'Charging' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('does NOT light a primary tab for a similarly-named section (exact-equality guard)', () => {
    // "Charging curve" must not activate the "Charging" tab — the reason the
    // selected check uses exact section-title equality and not a prefix test.
    renderBar('Charging curve')
    expect(screen.getByRole('button', { name: 'Charging' })).not.toHaveAttribute(
      'aria-current',
    )
    // An off-bar section falls back to More, keeping exactly one tab current.
    const current = screen
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-current'))
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName('More')
  })

  it('marks each tab glyph decorative (aria-hidden) and leaks no img role', () => {
    renderBar()
    const buttons = screen.getAllByRole('button')
    buttons.forEach((button) => {
      // One decorative icon per tab; the meaning is carried by the aria-label.
      expect(button.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
    })
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('renders the selected-state marker only on the active tab', () => {
    renderBar('Driving')
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    // Exactly one selected marker across the whole bar.
    const selected = selectedWithin(nav)
    expect(selected).toHaveLength(1)
    // ...and it belongs to the active tab.
    expect(selected[0]).toBe(screen.getByRole('button', { name: 'Driving' }))
    expect(
      screen.getByRole('button', { name: 'Charging' }),
    ).not.toHaveClass('is-selected')
  })

  it('uses readable theme surfaces and a non-color-only selected state', () => {
    renderBar('Charging')

    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(nav.className).toContain('sidenav-phone-tabs')
    expect(nav.className).toContain('safe-bottom')
    expect(nav.className).not.toContain('backdrop-blur')

    // The selected state is exposed three ways: the `is-selected` positional
    // marker (::before bar in sidenav.css), `aria-current` for assistive
    // tech, and the accent text color — never color alone.
    const active = screen.getByRole('button', { name: 'Charging' })
    expect(active.className).toContain('sidenav-phone-tab')
    expect(active).toHaveClass('is-selected')
    expect(active).toHaveAttribute('aria-current', 'true')
    expect(active.querySelector('svg')).toHaveAttribute('stroke-width', '1.8')

    const inactive = screen.getByRole('button', { name: 'Driving' })
    expect(inactive.className).toContain('sidenav-phone-tab')
    expect(inactive).not.toHaveClass('is-selected')
    expect(inactive).not.toHaveAttribute('aria-current')
    expect(inactive.querySelector('svg')).toHaveAttribute('stroke-width', '1.8')
  })

  it('lights More (and only More) when the section is off the bar', () => {
    renderBar('Settings')
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    const selected = selectedWithin(nav)
    expect(selected).toHaveLength(1)
    expect(selected[0]).toBe(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('reports the tapped section via onChoose, null for More', () => {
    const { onChoose } = renderBar('Home')
    expect(onChoose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Charging' }))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenLastCalledWith('Charging')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onChoose).toHaveBeenCalledTimes(2)
    expect(onChoose).toHaveBeenLastCalledWith(null)
    // Tapping never navigates by itself: no link roles appear.
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders tabs as native, focusable buttons (keyboard operable)', () => {
    renderBar()
    const first = screen.getByRole('button', { name: 'Home' })
    expect(first.tagName).toBe('BUTTON')
    expect(first).toHaveAttribute('type', 'button')
    first.focus()
    expect(first).toHaveFocus()
  })

  it('is a phone-only bar with iOS safe-area padding and 44px touch targets', () => {
    renderBar()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    // Phone-only display is CSS-driven: `sidenav-phone-tabs` hides at
    // >=768px and the deck mounts the bar only on phone viewports.
    expect(nav.className).toContain('sidenav-phone-tabs')
    expect(nav).toHaveClass('safe-bottom')
    // Fixed five-tab design: no scroll container by design.
    expect(nav.className).not.toContain('overflow-x-auto')
    screen.getAllByRole('button').forEach((button) => {
      // sidenav.css gives `.sidenav-phone-tab` min-height: 44px (WCAG 2.5.5).
      expect(button.className).toContain('sidenav-phone-tab')
      expect(button).toHaveAttribute('type', 'button')
    })
  })

  it('retains full long translated captions without truncation for RTL', () => {
    const longLabel = 'Eine sehr lange übersetzte Navigationsbeschriftung'
    tSpy.mockImplementation((key: string, fallback?: string) =>
      key === 'nav.mobileCharging' ? longLabel : fallback ?? key,
    )
    const { container } = renderBar('Charging')
    container.setAttribute('dir', 'rtl')
    const charging = screen.getByRole('button', { name: longLabel })
    expect(charging).toHaveTextContent(longLabel)
    expect(charging).toHaveAttribute('aria-current', 'true')
    expect(charging).toHaveClass('is-selected')
    expect(charging.querySelector('.sidenav-tab-label')).not.toHaveClass('truncate')
    expect(container).toHaveAttribute('dir', 'rtl')
  })

  it('retains keyboard activation, explicit focus and reduced-motion presentation', () => {
    const { onChoose } = renderBar('Home')
    const charging = screen.getByRole('button', { name: 'Charging' })
    charging.focus()
    expect(charging).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
    fireEvent.keyDown(charging, { key: 'Enter' })
    fireEvent.click(charging)
    expect(onChoose).toHaveBeenCalledWith('Charging')
    expect(charging.className).toContain('focus-visible:outline-[var(--focus-ring)]')
    expect(charging.className).toContain('forced-colors:focus-visible:outline-[Highlight]')
    expect(charging.className).toContain('motion-reduce:transition-none')
  })

  it.each(['ltr', 'rtl'])(
    'moves keyboard focus across every tab in order in %s without choosing',
    async (direction) => {
      const user = userEvent.setup()
      const labels = TABS.map((tab) => `${tab.label} — Sehr lange übersetzte Navigationsbeschriftung`)
      tSpy.mockImplementation((key: string, fallback?: string) => {
        const index = TABS.findIndex((tab) => tab.key === key)
        return index < 0 ? fallback ?? key : labels[index]
      })
      const { container, onChoose } = renderBar('Home')
      container.setAttribute('dir', direction)
      const buttons = screen.getAllByRole('button')

      expect(onChoose).not.toHaveBeenCalled()
      for (const [index, tab] of TABS.entries()) {
        await user.tab()
        expect(buttons[index]).toHaveFocus()
        expect(buttons[index]).toHaveAccessibleName(labels[index])
        expect(buttons[index]).toHaveTextContent(labels[index])
        // Focus alone never chooses: selection stays on Home throughout.
        expect(onChoose).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: labels[0] })).toHaveAttribute(
          'aria-current',
          'true',
        )
        expect(tab.label).toBe(TABS[index].label)
      }

      await user.tab({ shift: true })
      expect(buttons[3]).toHaveFocus()
      expect(onChoose).not.toHaveBeenCalled()

      // Explicit activation chooses the focused tab.
      await user.keyboard('{Enter}')
      expect(onChoose).toHaveBeenCalledTimes(1)
      expect(onChoose).toHaveBeenLastCalledWith('Charging')
    },
  )

  it('keeps focus and activation working without an onChoose handler (default noop)', () => {
    render(<BottomTabBar activeSection="Battery" />)
    const more = screen.getByRole('button', { name: 'More' })

    expect(() => more.focus()).not.toThrow()
    expect(more).toHaveFocus()
    expect(more).toHaveAttribute('aria-current', 'true')
    expect(() => fireEvent.click(more)).not.toThrow()
    expect(more).toHaveFocus()
  })
})

describe('BOTTOM_TAB_PATHS', () => {
  it('keeps sidebar-specific glyphs distinct while sharing other route glyphs', () => {
    const routes = new Map(navSections.flatMap(section => section.items.map(item => [item.to, item.icon] as const)))
    for (const [path, icon] of Object.entries(navRouteIcons)) {
      const sidebarPath = path === '/climate' ? '/climate-control' : path
      expect(routes.get(sidebarPath), path).toBe(SIDEBAR_ROUTE_ICONS[sidebarPath] ?? icon)
    }
  })

  it('is the exact set of the bottom-tab destinations', () => {
    expect(BOTTOM_TAB_PATHS).toBeInstanceOf(Set)
    expect(BOTTOM_TAB_PATHS.size).toBe(TAB_PATHS.length)
    for (const path of TAB_PATHS) {
      expect(BOTTOM_TAB_PATHS.has(path)).toBe(true)
    }
  })

  it('excludes routes that are not rendered on the bottom bar', () => {
    expect(BOTTOM_TAB_PATHS.has('/settings')).toBe(false)
    expect(BOTTOM_TAB_PATHS.has('/charging-curve')).toBe(false)
  })
})
