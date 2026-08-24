import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'
import { Icons } from '@/lib/icons'
import LinearSidebar, {
  type LinearSidebarProps,
  type LinearSidebarSectionInput,
} from '../LinearSidebar'

// navLabel is the caller's i18n mapper; default to identity so the rendered
// link text is exactly the string we feed in (keeps role-name queries stable).
const identity = (label: string) => label

function makeSections(): LinearSidebarSectionInput[] {
  return [
    {
      title: 'Fleet',
      items: [
        { to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' },
        { to: '/drives', icon: Icons.drive, label: 'Drives', dataTour: 'drives-tour' },
      ],
    },
    {
      title: 'Insights',
      items: [
        { to: '/analytics', icon: Icons.analytics, label: 'Analytics' },
        { to: '/notifications/alerts', icon: Icons.notifications, label: 'Alerts' },
      ],
    },
  ]
}

function buildProps(overrides: Partial<LinearSidebarProps> = {}): LinearSidebarProps {
  return {
    sections: makeSections(),
    pinnedItems: [],
    pathname: '/vehicles',
    navLabel: identity,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    ...overrides,
  }
}

function renderSidebar(overrides: Partial<LinearSidebarProps> = {}) {
  const props = buildProps(overrides)
  const result = render(
    <MemoryRouter initialEntries={[props.pathname || '/']}>
      <LinearSidebar {...props} />
    </MemoryRouter>,
  )
  // Rerender in place (same MemoryRouter root → LinearSidebar updates, keeping
  // internal state so prop-driven effects fire instead of remounting).
  const rerender = (next: Partial<LinearSidebarProps> = {}) => {
    const nextProps = buildProps({ ...overrides, ...next })
    result.rerender(
      <MemoryRouter initialEntries={[nextProps.pathname || '/']}>
        <LinearSidebar {...nextProps} />
      </MemoryRouter>,
    )
  }
  return { ...result, props, rerender }
}

const typeFilter = (value: string) =>
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } })

describe('LinearSidebar', () => {
  it('collapses every section except the one holding the active page', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })

    // Active section is expanded: its links render.
    expect(screen.getByRole('link', { name: /Vehicles/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Drives/ })).toBeInTheDocument()

    // Non-active section is collapsed: header shows, links hidden.
    expect(screen.getByRole('button', { name: /Insights/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /Analytics/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fleet/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the per-section item count on the header', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })
    const header = screen.getByRole('button', { name: /Fleet/ })
    expect(header.textContent).toContain('2')
  })

  it('marks the exact root path active only when the pathname is "/"', () => {
    const sections: LinearSidebarSectionInput[] = [
      {
        title: 'Nav',
        items: [
          { to: '/', icon: Icons.home, label: 'Home' },
          { to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' },
        ],
      },
    ]
    renderSidebar({ sections, pathname: '/', activeSectionTitle: 'Nav' })

    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Vehicles/ })).not.toHaveAttribute('aria-current')
  })

  it('treats a nested sub-path as active via prefix matching', () => {
    renderSidebar({ pathname: '/drives/42', activeSectionTitle: 'Fleet' })

    expect(screen.getByRole('link', { name: /Drives/ })).toHaveAttribute('aria-current', 'page')
    // /vehicles must NOT be active for /drives/42 (no false prefix hit).
    expect(screen.getByRole('link', { name: /Vehicles/ })).not.toHaveAttribute('aria-current')
  })

  it('expands and collapses a section when its header is clicked', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })

    const insights = screen.getByRole('button', { name: /Insights/ })
    expect(screen.queryByRole('link', { name: /Analytics/ })).not.toBeInTheDocument()

    fireEvent.click(insights)
    expect(screen.getByRole('link', { name: /Analytics/ })).toBeInTheDocument()
    expect(insights).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(insights)
    expect(screen.queryByRole('link', { name: /Analytics/ })).not.toBeInTheDocument()
  })

  it('auto-expands a section when it becomes the active one', () => {
    const { rerender } = renderSidebar({ activeSectionTitle: 'Fleet' })
    expect(screen.queryByRole('link', { name: /Analytics/ })).not.toBeInTheDocument()

    rerender({ activeSectionTitle: 'Insights' })
    expect(screen.getByRole('link', { name: /Analytics/ })).toBeInTheDocument()
  })

  it('renders the favorites group with an accessible unpin action', () => {
    const onUnpin = vi.fn()
    renderSidebar({
      pinnedItems: [{ to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' }],
      onUnpin,
      activeSectionTitle: 'Fleet',
    })

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Vehicles' }))
    expect(onUnpin).toHaveBeenCalledWith('/vehicles')
  })

  it('omits the favorites group entirely when nothing is pinned', () => {
    renderSidebar({ pinnedItems: [], activeSectionTitle: 'Fleet' })
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unpin/ })).not.toBeInTheDocument()
  })

  it('offers a pin action for un-pinned items and hides it for pinned ones', () => {
    const onPin = vi.fn()
    renderSidebar({
      pinnedItems: [{ to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' }],
      onPin,
      activeSectionTitle: 'Fleet',
    })

    // /drives is not pinned → pin button present; /vehicles is pinned → none.
    const pinDrives = screen.getByRole('button', { name: 'Pin Drives to favorites' })
    expect(screen.queryByRole('button', { name: 'Pin Vehicles to favorites' })).not.toBeInTheDocument()

    fireEvent.click(pinDrives)
    expect(onPin).toHaveBeenCalledWith('/drives')
  })

  it('renders trailing badges for alerts, vehicle count, and clamps at 99+', () => {
    const sections: LinearSidebarSectionInput[] = [
      {
        title: 'All',
        items: [
          { to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' },
          { to: '/notifications/alerts', icon: Icons.notifications, label: 'Alerts' },
          { to: '/data-repair', icon: Icons.database, label: 'Repair' },
        ],
      },
    ]
    renderSidebar({
      sections,
      activeSectionTitle: 'All',
      pathname: '/dashboard',
      alertCount: 2,
      vehicleCount: 150,
      staleCount: 5,
    })

    // Notification dot lives inside the alerts link.
    const alerts = screen.getByRole('link', { name: /Alerts/ })
    expect(alerts.querySelector('.rounded-full')).not.toBeNull()

    // Vehicle chip clamps 150 → "99+" and keeps the full count in its label.
    const vehicleChip = screen.getByLabelText('150 vehicles')
    expect(vehicleChip).toHaveTextContent('99+')

    // Stale-data chip shows the exact small count.
    expect(screen.getByLabelText('5 stale rows')).toHaveTextContent('5')
  })

  it('omits trailing badges when the counts are zero', () => {
    const sections: LinearSidebarSectionInput[] = [
      {
        title: 'All',
        items: [
          { to: '/notifications/alerts', icon: Icons.notifications, label: 'Alerts' },
          { to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' },
        ],
      },
    ]
    renderSidebar({ sections, activeSectionTitle: 'All', pathname: '/dashboard' })

    const alerts = screen.getByRole('link', { name: /Alerts/ })
    expect(alerts.querySelector('.rounded-full')).toBeNull()
    expect(screen.queryByLabelText(/vehicles/)).not.toBeInTheDocument()
  })

  it('fires onItemSelect when a navigation link is followed', async () => {
    const onItemSelect = vi.fn()
    renderSidebar({ onItemSelect, activeSectionTitle: 'Fleet' })

    // GuardedNavLink resolves its (no-op) guard asynchronously before
    // navigating, so flush the microtask queue inside act to settle it.
    await act(async () => {
      fireEvent.click(screen.getByRole('link', { name: /Vehicles/ }))
    })
    expect(onItemSelect).toHaveBeenCalledTimes(1)
  })

  it('exposes a labelled search box that filters the tree and auto-expands matches', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })

    const box = screen.getByRole('searchbox')
    expect(box).toHaveAttribute('type', 'search')

    // Analytics lives in the collapsed "Insights" section — hidden until it matches.
    expect(screen.queryByRole('link', { name: /Analytics/ })).not.toBeInTheDocument()

    typeFilter('anal')
    expect(screen.getByRole('link', { name: /Analytics/ })).toBeInTheDocument()
    // Non-matching rows drop out even from the active section.
    expect(screen.queryByRole('link', { name: /Vehicles/ })).not.toBeInTheDocument()
  })

  it('shows an empty state with a working "Clear filter" action', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })

    typeFilter('zzznomatch')
    expect(screen.getByText('No matches.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Vehicles/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Clear filter/ }))
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Vehicles/ })).toBeInTheDocument()
  })

  it('hides the favorites header when the active filter excludes every pinned item', () => {
    renderSidebar({
      pinnedItems: [{ to: '/settings', icon: Icons.settings, label: 'Settings' }],
      activeSectionTitle: 'Fleet',
    })

    // Before filtering, the pinned favorite is visible under its header.
    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument()

    typeFilter('vehicles')

    // The favorite no longer matches → header + row both gone (no orphan label).
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Settings/ })).not.toBeInTheDocument()
    // A section item matched, so this is NOT an empty result.
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Vehicles/ })).toBeInTheDocument()
  })

  it('keeps a matching favorite visible without a false "No matches" message', () => {
    renderSidebar({
      pinnedItems: [{ to: '/settings', icon: Icons.settings, label: 'Settings' }],
      activeSectionTitle: 'Fleet',
    })

    // "settings" matches only the (unmirrored) favorite, no section item.
    typeFilter('settings')

    expect(screen.getByRole('link', { name: /Settings/ })).toBeInTheDocument()
    // Regression: the empty state must not appear while a favorite still matches.
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
  })

  it('applies navLabel to translate item label keys', () => {
    const navLabel = (key: string) => (key === 'key.vehicles' ? 'Fahrzeuge' : key)
    const sections: LinearSidebarSectionInput[] = [
      { title: 'Fleet', items: [{ to: '/vehicles', icon: Icons.vehicle, label: 'key.vehicles' }] },
    ]
    renderSidebar({ sections, navLabel, activeSectionTitle: 'Fleet' })

    expect(screen.getByRole('link', { name: /Fahrzeuge/ })).toBeInTheDocument()
    expect(screen.queryByText('key.vehicles')).not.toBeInTheDocument()
  })

  it('labels the navigation landmark and skips empty sections', () => {
    const sections: LinearSidebarSectionInput[] = [
      { title: 'Fleet', items: [{ to: '/vehicles', icon: Icons.vehicle, label: 'Vehicles' }] },
      { title: 'Empty', items: [] },
    ]
    renderSidebar({ sections, activeSectionTitle: 'Fleet' })

    const nav = screen.getByRole('navigation', { name: 'Sidebar navigation' })
    expect(within(nav).getByRole('link', { name: /Vehicles/ })).toBeInTheDocument()
    // An items-less section never renders a header.
    expect(screen.queryByRole('button', { name: /Empty/ })).not.toBeInTheDocument()
  })

  it('renders without crashing when sections and pinnedItems are omitted', () => {
    // Null-safety: JS callers that pass no arrays must not throw.
    render(
      <MemoryRouter initialEntries={['/']}>
        <LinearSidebar
          {...({
            pathname: '/',
            navLabel: identity,
            onPin: vi.fn(),
            onUnpin: vi.fn(),
          } as unknown as LinearSidebarProps)}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Sidebar navigation' })).toBeInTheDocument()
    expect(screen.queryByText('Favorites')).not.toBeInTheDocument()
  })
})

// ══════════════════════════════════════════════════════════════════════
// "Browse all features" escape hatch (compact IA)
// ══════════════════════════════════════════════════════════════════════

describe('LinearSidebar — Feature Hub escape hatch', () => {
  const compactSections: LinearSidebarSectionInput[] = [
    {
      title: 'Overview',
      items: [
        { to: '/', icon: Icons.home, label: 'Dashboard' },
        { to: '/explore', icon: Icons.sparkles, label: 'Explore Features' },
      ],
    },
    {
      title: 'Driving',
      items: [{ to: '/drives', icon: Icons.drive, label: 'Drives' }],
    },
  ]

  it('omits the footer link while the Overview /explore row is on screen', () => {
    renderSidebar({ sections: compactSections, pathname: '/', activeSectionTitle: 'Overview' })

    expect(screen.getByRole('link', { name: /Explore Features/ })).toBeInTheDocument()
    // No duplicate: the footer stays out of the way when the row is visible.
    expect(screen.queryByTestId('linear-sidebar-explore-footer')).not.toBeInTheDocument()
  })

  it('surfaces a footer link to /explore when Overview is collapsed', () => {
    renderSidebar({ sections: compactSections, pathname: '/drives', activeSectionTitle: 'Driving' })

    // Overview is collapsed, so its /explore row is not rendered…
    expect(screen.getByRole('button', { name: /Overview/ })).toHaveAttribute('aria-expanded', 'false')
    const footer = screen.getByTestId('linear-sidebar-explore-footer')
    const link = within(footer).getByRole('link', { name: /Browse all features/ })
    expect(link).toHaveAttribute('href', '/explore')
  })

  it('closes the mobile drawer when the footer link is followed', async () => {
    const onItemSelect = vi.fn()
    renderSidebar({
      sections: compactSections,
      pathname: '/drives',
      activeSectionTitle: 'Driving',
      onItemSelect,
    })

    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId('linear-sidebar-explore-footer')).getByRole('link'),
      )
    })
    expect(onItemSelect).toHaveBeenCalledTimes(1)
  })

  it('hides the footer while a tree filter is active', () => {
    renderSidebar({ sections: compactSections, pathname: '/drives', activeSectionTitle: 'Driving' })
    expect(screen.getByTestId('linear-sidebar-explore-footer')).toBeInTheDocument()

    typeFilter('drives')
    expect(screen.queryByTestId('linear-sidebar-explore-footer')).not.toBeInTheDocument()
  })

  it('never renders the footer for trees that have no /explore entry', () => {
    renderSidebar({ activeSectionTitle: 'Fleet' })
    expect(screen.queryByTestId('linear-sidebar-explore-footer')).not.toBeInTheDocument()
  })
})
