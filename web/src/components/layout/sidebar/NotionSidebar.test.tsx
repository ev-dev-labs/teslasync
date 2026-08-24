/**
 * NotionSidebar tests.
 *
 * NotionSidebar is a presentation-only nav tree: it renders collapsible
 * sections + a Favorites group from props and delegates every side effect
 * (pin / unpin / follow-link) to callbacks the hosting Layout supplies.
 * These tests pin the behaviour that matters:
 *
 *   1. Structure — the nav landmark, the "Pages" group, one collapsible
 *      button per section, and per-section item counts render.
 *   2. Expansion — only the active section is open on first paint; the whole
 *      row toggles open/closed and reveals/hides its item links.
 *   3. Active path — isActiveNotionPath drives the row's active styling for
 *      exact, prefix, and root ('/') matches (root only on exact '/').
 *   4. Favorites + pin/unpin — the group only appears with pins, an unpinned
 *      item exposes a Pin action, a pinned item an Unpin action, and both fire
 *      the right callback with the route.
 *   5. Trailing badges — the vehicle / stale-row count chips (capped at 99+)
 *      and the unread dot render for the mapped routes, and nothing renders
 *      when the counts are zero.
 *   6. Null-safety + empty state — undefined/empty section & pinned props
 *      degrade to a "No pages yet." panel instead of a blank column or a
 *      `.map` crash.
 *
 * react-i18next is mocked to a faithful `t(key, fallback|opts)` that returns
 * the fallback string / interpolated defaultValue, so the accessible names
 * resolve deterministically without booting the full i18n runtime (the
 * FavoritesBar.test.tsx convention, extended for the `{ defaultValue }`
 * signature this component uses). `@testing-library/user-event` is not a repo
 * dependency, so `fireEvent` drives interactions — matching every other
 * component test here. No network is touched.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Icons } from '@/lib/icons'
import NotionSidebarDefault, {
  NotionSidebar,
  type NotionSidebarProps,
  type NotionSidebarSectionInput,
} from './NotionSidebar'

// Faithful `t` mock: `t('k', 'Fallback')` -> 'Fallback';
// `t('k', { defaultValue: 'Pin {{page}}', page: 'X' })` -> 'Pin X'.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: string | Record<string, unknown>) => {
      if (typeof second === 'string') return second
      if (second && typeof second === 'object') {
        const dv = typeof second.defaultValue === 'string' ? second.defaultValue : key
        return dv.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(second[name] ?? ''))
      }
      return key
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

// ── Fixtures ────────────────────────────────────────────────────────────────
const homeItem = { to: '/', icon: Icons.home, label: 'Home' }
const vehiclesItem = {
  to: '/vehicles',
  icon: Icons.vehicle,
  label: 'Vehicles',
  dataTour: 'vehicles-tour',
}
const alertsItem = { to: '/notifications/alerts', icon: Icons.notifications, label: 'Alerts' }
const chargingItem = { to: '/charging', icon: Icons.charging, label: 'Charging', color: 'text-emerald-300' }
const dataRepairItem = { to: '/data-repair', icon: Icons.database, label: 'Data Repair' }

function makeSections(): NotionSidebarSectionInput[] {
  return [
    { title: 'Overview', items: [homeItem, vehiclesItem] },
    { title: 'Fleet', items: [alertsItem, chargingItem, dataRepairItem] },
  ]
}

function baseProps(overrides: Partial<NotionSidebarProps> = {}): NotionSidebarProps {
  return {
    sections: makeSections(),
    pinnedItems: [],
    pathname: '/',
    navLabel: (label: string) => label,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    ...overrides,
  }
}

function renderSidebar(overrides: Partial<NotionSidebarProps> = {}) {
  const props = baseProps(overrides)
  const utils = render(
    <MemoryRouter initialEntries={[props.pathname]}>
      <NotionSidebar {...props} />
    </MemoryRouter>,
  )
  return { ...utils, props }
}

// The component's own deterministic active marker (from isActiveNotionPath),
// independent of react-router NavLink's own aria-current route matching.
const ACTIVE_CLASS = 'bg-[var(--surface-2)]'

afterEach(() => cleanup())

describe('NotionSidebar', () => {
  it('renders the nav landmark, the Pages group, and a collapsed row per section with its item count', () => {
    renderSidebar()

    expect(screen.getByRole('navigation', { name: 'Sidebar navigation' })).toBeInTheDocument()
    expect(screen.getByText('Pages')).toBeInTheDocument()

    const overview = screen.getByRole('button', { name: /Overview/ })
    const fleet = screen.getByRole('button', { name: /Fleet/ })
    // No activeSectionTitle -> every section starts collapsed.
    expect(overview).toHaveAttribute('aria-expanded', 'false')
    expect(fleet).toHaveAttribute('aria-expanded', 'false')
    // Section glyph rows show the child count.
    expect(within(overview).getByText('2')).toBeInTheDocument()
    expect(within(fleet).getByText('3')).toBeInTheDocument()
    // Collapsed => no item links rendered yet.
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens only the active section on first paint and renders its items as links', () => {
    renderSidebar({ activeSectionTitle: 'Overview' })

    expect(screen.getByRole('button', { name: /Overview/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Fleet/ })).toHaveAttribute('aria-expanded', 'false')

    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vehicles' })).toBeInTheDocument()
    // Fleet is collapsed, so its items stay out of the DOM.
    expect(screen.queryByRole('link', { name: 'Alerts' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Overview' })).toBeInTheDocument()
  })

  it('toggles a section open then closed when its row is clicked', () => {
    renderSidebar()

    expect(screen.queryByRole('link', { name: 'Alerts' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Fleet/ }))
    expect(screen.getByRole('button', { name: /Fleet/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Fleet/ }))
    expect(screen.getByRole('button', { name: /Fleet/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Alerts' })).toBeNull()
  })

  it('invokes onItemSelect when an item link is followed (mobile drawer close)', () => {
    const onItemSelect = vi.fn()
    renderSidebar({ activeSectionTitle: 'Overview', onItemSelect })

    fireEvent.click(screen.getByRole('link', { name: 'Home' }))
    expect(onItemSelect).toHaveBeenCalledTimes(1)
  })

  it('marks the exact-match root link active and leaves off-root links inactive', () => {
    renderSidebar({ pathname: '/', activeSectionTitle: 'Overview' })

    const home = screen.getByRole('link', { name: 'Home' })
    const vehicles = screen.getByRole('link', { name: 'Vehicles' })

    expect(home).toHaveClass(ACTIVE_CLASS)
    expect(home).toHaveAttribute('aria-current', 'page')
    expect(vehicles).not.toHaveClass(ACTIVE_CLASS)
    expect(vehicles).not.toHaveAttribute('aria-current')
  })

  it('treats a nested path as a prefix match and keeps the root link inactive off-root', () => {
    renderSidebar({ pathname: '/vehicles/123', activeSectionTitle: 'Overview' })

    const vehicles = screen.getByRole('link', { name: 'Vehicles' })
    const home = screen.getByRole('link', { name: 'Home' })

    // '/vehicles/123'.startsWith('/vehicles/') -> active.
    expect(vehicles).toHaveClass(ACTIVE_CLASS)
    expect(vehicles).toHaveAttribute('aria-current', 'page')
    // to === '/' only matches an exact '/', so Home is NOT active here.
    expect(home).not.toHaveClass(ACTIVE_CLASS)
  })

  it('hides the Favorites group and any unpin control when nothing is pinned', () => {
    renderSidebar({ pinnedItems: [] })

    expect(screen.queryByText('Favorites')).toBeNull()
    expect(screen.queryByRole('button', { name: /Unpin/ })).toBeNull()
  })

  it('shows the Favorites group with a pinned item and an unpin control', () => {
    // No activeSectionTitle => sections collapsed, so the only "Vehicles"
    // link and "Unpin Vehicles" button come from the Favorites group.
    renderSidebar({ pinnedItems: [vehiclesItem] })

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vehicles' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unpin Vehicles' })).toBeInTheDocument()
  })

  it('fires onUnpin with the route when a favorite unpin button is clicked', () => {
    const onUnpin = vi.fn()
    // Charging lives in the (collapsed) Fleet section, so its only unpin
    // control is the Favorites one — no duplicate to disambiguate.
    renderSidebar({ pinnedItems: [chargingItem], activeSectionTitle: 'Overview', onUnpin })

    fireEvent.click(screen.getByRole('button', { name: 'Unpin Charging' }))
    expect(onUnpin).toHaveBeenCalledTimes(1)
    expect(onUnpin).toHaveBeenCalledWith('/charging')
  })

  it('fires onPin with the route when an unpinned item pin button is clicked', () => {
    const onPin = vi.fn()
    renderSidebar({ activeSectionTitle: 'Overview', onPin })

    fireEvent.click(screen.getByRole('button', { name: 'Pin Home' }))
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onPin).toHaveBeenCalledWith('/')
  })

  it('offers Unpin (not Pin) for an item that is already pinned but still listed in its section', () => {
    renderSidebar({ pinnedItems: [vehiclesItem], activeSectionTitle: 'Overview' })

    // One unpin in Favorites + one on the in-section row = 2.
    expect(screen.getAllByRole('button', { name: 'Unpin Vehicles' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Pin Vehicles' })).toBeNull()
    // A sibling that is NOT pinned still offers a Pin action.
    expect(screen.getByRole('button', { name: 'Pin Home' })).toBeInTheDocument()
  })

  it('keeps one canonical active row when the current page is also a favorite', () => {
    renderSidebar({
      pinnedItems: [vehiclesItem],
      activeSectionTitle: 'Overview',
      pathname: '/vehicles',
    })

    const vehicleLinks = screen.getAllByRole('link', { name: 'Vehicles' })
    expect(vehicleLinks).toHaveLength(2)
    expect(vehicleLinks.filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('renders a vehicle-count chip on /vehicles and caps large counts at 99+', () => {
    renderSidebar({ activeSectionTitle: 'Overview', vehicleCount: 7 })
    const chip = screen.getByText('7')
    expect(chip).toHaveAttribute('aria-label', '7 vehicles')

    cleanup()

    renderSidebar({ activeSectionTitle: 'Overview', vehicleCount: 150 })
    const capped = screen.getByText('99+')
    expect(capped).toHaveAttribute('aria-label', '150 vehicles')
  })

  it('renders a stale-row chip and an unread dot for the mapped routes', () => {
    renderSidebar({ activeSectionTitle: 'Fleet', staleCount: 5, alertCount: 1 })

    const staleChip = screen.getByText('5')
    expect(staleChip).toHaveAttribute('aria-label', '5 stale rows')

    const alertsLink = screen.getByRole('link', { name: 'Alerts' })
    // The unread indicator is a decorative (aria-hidden) dot span.
    expect(alertsLink.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('renders no badges when every count is zero', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })

    const alertsLink = screen.getByRole('link', { name: 'Alerts' })
    expect(alertsLink.querySelector('span[aria-hidden="true"]')).toBeNull()
    // No count chip suffix, so the accessible name stays exact.
    expect(screen.getByRole('link', { name: 'Data Repair' })).toBeInTheDocument()
    expect(screen.queryByText('5')).toBeNull()
  })

  it('forwards the item data-tour attribute onto the link and omits it when absent', () => {
    renderSidebar({ activeSectionTitle: 'Overview' })

    expect(screen.getByRole('link', { name: 'Vehicles' })).toHaveAttribute('data-tour', 'vehicles-tour')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('data-tour')
  })

  it('shows a "No pages yet." empty state instead of a blank panel when there are no sections', () => {
    renderSidebar({ sections: [] })

    expect(screen.getByTestId('notion-sidebar-empty')).toBeInTheDocument()
    expect(screen.getByText('No pages yet.')).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Sidebar navigation' })).toBeInTheDocument()
  })

  it('degrades safely (no throw, empty state, no Favorites) when array props are undefined', () => {
    expect(() =>
      renderSidebar({
        sections: undefined as unknown as NotionSidebarSectionInput[],
        pinnedItems: undefined as unknown as NotionSidebarProps['pinnedItems'],
      }),
    ).not.toThrow()

    expect(screen.getByText('No pages yet.')).toBeInTheDocument()
    expect(screen.queryByText('Favorites')).toBeNull()
  })

  it('exposes the same component as the default and named export', () => {
    expect(NotionSidebarDefault).toBe(NotionSidebar)
  })
})
