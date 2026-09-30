/**
 * CommandDeck tests.
 *
 * The Command Deck is master-detail navigation: a section rail (hub
 * shortcuts + every parent group, collapsible to icons) plus the Atlas
 * secondary panel docked beside it on the same surface. Desktop keeps
 * the rail in-flow and docks/undocks the panel; the mobile drawer
 * drills rail → panel with a Back button.
 *
 * Panel-open state is host-owned (Layout derives the aside width from
 * it), so interaction tests use a small controlled harness below while
 * static tests render the component directly.
 *
 * jsdom renders all breakpoint variants at once (the `xl:` split is
 * CSS-only), so every query is scoped with `within()` to one of
 * `command-deck-rail`, `command-deck-secondary`,
 * `command-deck-mobile-rail`, or `command-deck-mobile-panel`. Real
 * browsers show exactly one rail + one panel — e2e covers true
 * per-viewport visibility.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Icons } from '@/lib/icons'
import type { SectionGroup } from '../sectionGroups'
import CommandDeckDefault, { CommandDeck, type CommandDeckProps } from './CommandDeck'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: string | Record<string, unknown>, third?: Record<string, unknown>) => {
      if (typeof second === 'string') {
        if (third && typeof third === 'object') {
          return second.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(third[name] ?? ''))
        }
        return second
      }
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

const homeItem = { to: '/', icon: Icons.home, label: 'Dashboard', labelKey: 'nav.items.dashboard' }
const drivesItem = { to: '/drives', icon: Icons.drive, label: 'Drives', labelKey: 'nav.items.drives' }
const tripsItem = { to: '/trips', icon: Icons.trip, label: 'Trips', labelKey: 'nav.items.trips' }
const alertsItem = { to: '/notifications/inbox', icon: Icons.notifications, label: 'All Notifications', labelKey: 'nav.items.notifications_inbox' }

function makeSections() {
  return [
    { title: 'Home', titleKey: 'nav.groups.home', items: [homeItem] },
    { title: 'Driving', titleKey: 'nav.groups.driving', items: [drivesItem, tripsItem, alertsItem] },
  ]
}

const tripCollection: SectionGroup = {
  primary: '/trips',
  label: 'Trip Records',
  labelKey: 'nav.collections.trips',
  pages: [
    { to: '/trips', label: 'Trips', labelKey: 'nav.items.trips' },
    { to: '/mileage', label: 'Mileage Log', labelKey: 'nav.items.mileage' },
  ],
}
const driveCollection: SectionGroup = {
  primary: '/drives',
  label: 'Drive Records',
  labelKey: 'nav.collections.drives',
  pages: [
    { to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' },
    { to: '/drive-calendar', label: 'Drive Calendar', labelKey: 'nav.items.drive-calendar' },
  ],
}

function baseProps(overrides: Partial<CommandDeckProps> = {}): CommandDeckProps {
  return {
    sections: makeSections(),
    pinnedItems: [],
    pathname: '/',
    navLabel: (item: { label: string }) => item.label,
    navSectionTitle: (section: { title: string }) => section.title,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    railCollapsed: false,
    onToggleRailCollapsed: vi.fn(),
    panelOpen: false,
    onPanelOpenChange: vi.fn(),
    panelCollapsed: false,
    onTogglePanelCollapsed: vi.fn(),
    ...overrides,
  }
}

function renderDeck(overrides: Partial<CommandDeckProps> = {}) {
  const props = baseProps(overrides)
  const utils = render(
    <MemoryRouter initialEntries={[props.pathname]}>
      <CommandDeck {...props} />
    </MemoryRouter>,
  )
  return { ...utils, props }
}

/** Host-like harness: panel-open state lives outside the deck. */
function renderControlledDeck(overrides: Partial<CommandDeckProps> = {}) {
  const props = baseProps(overrides)
  function Harness() {
    const [panelOpen, setPanelOpen] = useState(false)
    const [panelCollapsed, setPanelCollapsed] = useState(props.panelCollapsed)
    const [railCollapsed, setRailCollapsed] = useState(props.railCollapsed)
    return (
      <MemoryRouter initialEntries={[props.pathname]}>
        <CommandDeck
          {...props}
          railCollapsed={railCollapsed}
          onToggleRailCollapsed={() => setRailCollapsed(previous => !previous)}
          panelOpen={panelOpen}
          onPanelOpenChange={setPanelOpen}
          panelCollapsed={panelCollapsed}
          onTogglePanelCollapsed={() => {
            setPanelCollapsed(previous => !previous)
            if (!panelCollapsed) setRailCollapsed(true)
          }}
        />
      </MemoryRouter>
    )
  }
  return render(<Harness />)
}

const desktopRail = () => within(screen.getByTestId('command-deck-rail'))
const mobileRail = () => within(screen.getByTestId('command-deck-mobile-rail'))
const secondaryPanel = () => within(screen.getByTestId('command-deck-secondary'))
const mobilePanel = () => within(screen.getByTestId('command-deck-mobile-panel'))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('CommandDeck', () => {
  it('exports the component as both a named and default export', () => {
    expect(CommandDeckDefault).toBe(CommandDeck)
  })

  it('lists hub shortcuts, every group with counts, and utility links', () => {
    renderDeck({
      pinnedItems: [drivesItem],
      suggestions: [{ ...tripsItem, reason: 'Related to Drives', kind: 'related' as const }],
      alertCount: 3,
      vehicleCount: 2,
      collections: [tripCollection],
    })

    expect(desktopRail().queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Suggested' })).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'All pages' })).toHaveAttribute('href', '/explore')
    expect(desktopRail().getByRole('button', { name: 'Home, 1 pages' })).toBeInTheDocument()
    // Pinned Drives stays in the count: drives + trips + mileage + alerts.
    expect(desktopRail().getByRole('button', { name: 'Driving, 4 pages' })).toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
    expect(desktopRail().queryByRole('link', { name: 'Cars' })).not.toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'Display' })).toHaveAttribute('href', '/settings#appearance')
    expect(desktopRail().getByLabelText('1 suggestions')).toBeInTheDocument()
    expect(desktopRail().getByLabelText('1 pinned pages')).toBeInTheDocument()
    expect(desktopRail().getByLabelText('3 unread alerts')).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute('aria-expanded', 'true')
    expect(desktopRail().getByRole('button', { name: 'Collapse sidebar' })).toHaveTextContent('Collapse')
  })

  it('collapses to icons via the host toggle, keeping accessible names', () => {
    const onToggleRailCollapsed = vi.fn()
    const first = renderDeck({ onToggleRailCollapsed })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Collapse sidebar' }))
    expect(onToggleRailCollapsed).toHaveBeenCalledTimes(1)
    first.unmount()

    renderDeck({ railCollapsed: true })
    expect(desktopRail().queryByText('Suggested')).toBeNull()
    expect(desktopRail().queryByText('Driving')).toBeNull()
    expect(desktopRail().getByRole('button', { name: 'Driving, 3 pages' })).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps My Vehicles and its count in the Vehicles section, not the primary shortcuts', () => {
    const sections = [
      ...makeSections(),
      { title: 'Vehicles', titleKey: 'nav.groups.vehicles', items: [{ to: '/vehicles', icon: Icons.vehicle, label: 'My Vehicles', labelKey: 'nav.items.vehicles' }] },
    ]
    renderControlledDeck({ sections, vehicleCount: 2 })

    expect(desktopRail().queryByRole('link', { name: 'Cars' })).not.toBeInTheDocument()
    fireEvent.click(desktopRail().getByRole('button', { name: 'Vehicles, 1 pages' }))
    const vehiclesLink = secondaryPanel().getByRole('link', { name: /My Vehicles/ })
    expect(vehiclesLink).toHaveAttribute('href', '/vehicles')
    expect(within(vehiclesLink).getByLabelText('2 vehicles')).toBeInTheDocument()
  })

  it('shows an instant label flyout on icons-only buttons', () => {
    renderDeck({ railCollapsed: true, suggestions: [{ ...tripsItem, reason: 'Related', kind: 'related' as const }] })

    const suggested = desktopRail().getByRole('button', { name: 'Suggested' })
    fireEvent.mouseOver(suggested)
    const tip = screen.getByTestId('rail-tip')
    expect(tip).toHaveTextContent('Suggested')
    expect(tip).toHaveTextContent('1 suggestions')
    fireEvent.mouseOut(suggested)
    expect(screen.queryByTestId('rail-tip')).toBeNull()

    // Keyboard focus gets the same affordance as hover.
    const driving = desktopRail().getByRole('button', { name: 'Driving, 3 pages' })
    act(() => { driving.focus() })
    expect(screen.getByTestId('rail-tip')).toHaveTextContent('Driving')
    expect(screen.getByTestId('rail-tip')).toHaveTextContent('3 pages')
    act(() => { driving.blur() })
    expect(screen.queryByTestId('rail-tip')).toBeNull()
  })

  it('shows no flyout when labels are already visible', () => {
    renderDeck({ railCollapsed: false })
    fireEvent.mouseOver(desktopRail().getByRole('button', { name: 'Suggested' }))
    expect(screen.queryByTestId('rail-tip')).toBeNull()
  })

  it('docks the secondary panel to a group and collapses it on re-press', () => {
    renderControlledDeck({ collections: [tripCollection] })
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()

    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 4 pages' }))
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Driving, 4 pages' })).toHaveAttribute('aria-pressed', 'true')

    // The active primary item is itself a collapse control.
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 4 pages' }))
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
  })

  it('collapses a collection without removing its pages or moving pinned pages', () => {
    const onPin = vi.fn()
    renderControlledDeck({ collections: [tripCollection], onPin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 4 pages' }))
    const group = secondaryPanel().getByRole('button', { name: 'Trip Records' })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pin Mileage Log to favorites' }))
    expect(onPin).toHaveBeenCalledWith('/mileage')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
  })

  it('offers a context-aware expand/collapse all control for multiple collections', () => {
    renderControlledDeck({ collections: [driveCollection, tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 5 pages' }))
    expect(secondaryPanel().getByRole('button', { name: 'Drive Records' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Expand all groups' }))
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Collapse all groups' }))
    expect(secondaryPanel().getByRole('button', { name: 'Drive Records' })).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Expand all groups' }))
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Trip Records' }))
    expect(secondaryPanel().getByRole('button', { name: 'Expand all groups' })).toBeInTheDocument()
  })

  it('opens only the active collection and shows the other collection count', () => {
    renderControlledDeck({ pathname: '/drive-calendar', collections: [driveCollection, tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 5 pages' }))
    const driveGroup = secondaryPanel().getByRole('button', { name: 'Drive Records' })
    const tripGroup = secondaryPanel().getByRole('button', { name: 'Trip Records' })
    expect(driveGroup).toHaveAttribute('aria-expanded', 'true')
    expect(tripGroup).toHaveAttribute('aria-expanded', 'false')
    expect(tripGroup).toHaveTextContent('2')
    expect(secondaryPanel().getByRole('link', { name: 'Drive Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(tripGroup)
    expect(tripGroup).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
  })

  it('filters only the open section and retains group controls and clear', () => {
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving', collections: [driveCollection, tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 5 pages' }))
    const filter = secondaryPanel().getByRole('searchbox', { name: 'Filter Driving tools' })
    fireEvent.change(filter, { target: { value: 'mile' } })
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('link', { name: 'Drive Calendar' })).not.toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'Drive Records' } })
    expect(secondaryPanel().getByRole('link', { name: 'Drive Calendar' })).toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'not-a-page' } })
    expect(secondaryPanel().getByRole('status')).toHaveTextContent('No tools match "not-a-page".')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    expect(filter).toHaveValue('')
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
  })

  it('moves real pinned pages into section quick access and removes them from either surface', async () => {
    function Harness() {
      const [pinned, setPinned] = useState(false)
      return (
        <MemoryRouter initialEntries={['/drives']}>
          <CommandDeck
            {...baseProps({ pathname: '/drives', activeSectionTitle: 'Driving', panelOpen: true })}
            pinnedItems={pinned ? [tripsItem] : []}
            onPin={() => setPinned(true)}
            onUnpin={() => setPinned(false)}
          />
        </MemoryRouter>
      )
    }
    render(<Harness />)
    const toggle = secondaryPanel().getByRole('button', { name: 'Quick access pins' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pin Trips to favorites' }))
    // Quick access starts collapsed: the pin lands but stays hidden until expanded.
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('button', { name: 'Remove Trips from quick access' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
    // Collapsing hides the pins again, but filtering forces them back open so
    // a collapsed match never reads as a missing result.
    fireEvent.click(toggle)
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.change(secondaryPanel().getByRole('searchbox', { name: 'Filter Driving tools' }), { target: { value: 'no matching pages' } })
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    fireEvent.click(toggle)
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Remove Trips from quick access' }))
    await waitFor(() => expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument())
    expect(secondaryPanel().getByText('Pin a page below to keep it close.')).toBeInTheDocument()
  })

  it('never duplicates the current page into section quick access', () => {
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving', pinnedItems: [drivesItem, tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 3 pages' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Quick access pins' }))
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Drives' })).not.toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
  })

  it('remembers quick pins and recents expansion across remounts without opening filtered pins permanently', () => {
    const props = baseProps({
      pathname: '/drives',
      activeSectionTitle: 'Driving',
      panelOpen: true,
      pinnedItems: [tripsItem],
      recentItems: [tripsItem],
    })
    const first = render(
      <MemoryRouter initialEntries={['/drives']}>
        <CommandDeck {...props} />
      </MemoryRouter>,
    )
    const pins = secondaryPanel().getByRole('button', { name: 'Quick access pins' })
    fireEvent.change(secondaryPanel().getByRole('searchbox', { name: 'Filter Driving tools' }), {
      target: { value: 'Trips' },
    })
    expect(pins).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem('teslasync-deck-quick-pins-open')).toBeNull()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    expect(pins).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(pins)
    expect(window.localStorage.getItem('teslasync-deck-quick-pins-open')).toBe('true')
    first.unmount()

    render(
      <MemoryRouter initialEntries={['/drives']}>
        <CommandDeck {...props} />
      </MemoryRouter>,
    )
    expect(secondaryPanel().getByRole('button', { name: 'Quick access pins' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()

    cleanup()
    renderControlledDeck({ pathname: '/', recentItems: [tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Suggested' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Show recently used' }))
    expect(window.localStorage.getItem('teslasync-deck-recent-open')).toBe('true')
    cleanup()
    renderControlledDeck({ pathname: '/', recentItems: [tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Suggested' }))
    expect(secondaryPanel().getByRole('button', { name: 'Hide recently used' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Trips' })).toBeInTheDocument()
  })

  it('collapses the secondary panel via its header, returning focus to the rail', () => {
    renderControlledDeck()
    const drivingButton = desktopRail().getByRole('button', { name: 'Driving, 3 pages' })

    fireEvent.click(drivingButton)
    fireEvent.keyDown(screen.getByTestId('atlas-panel-secondary'), { key: 'Escape' })
    expect(screen.getByTestId('command-deck-secondary')).toBeInTheDocument()

    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Close panel' }))
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
    expect(document.activeElement).toBe(drivingButton)
  })

  it('keeps a collapsed secondary rail navigable with icon labels on hover and focus', () => {
    renderControlledDeck({ collections: [tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 4 pages' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Collapse secondary navigation' }))
    expect(secondaryPanel().getByRole('navigation', { name: 'Sidebar navigation' })).toHaveAttribute('data-collapsed', 'true')
    expect(desktopRail().queryByText('Driving')).toBeNull()
    const mileage = secondaryPanel().getByRole('link', { name: 'Mileage Log' })
    expect(mileage).toHaveAttribute('aria-label', 'Mileage Log')
    expect(mileage).not.toHaveTextContent('Mileage Log')
    fireEvent.mouseOver(mileage)
    expect(screen.getByTestId('atlas-tip')).toHaveTextContent('Mileage Log')
    fireEvent.mouseOut(mileage)
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Trip Records' }))
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Trip Records' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Expand secondary navigation' }))
    expect(secondaryPanel().getByRole('navigation', { name: 'Sidebar navigation' })).toHaveAttribute('data-collapsed', 'false')
    expect(desktopRail().queryByText('Driving')).toBeNull()
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
  })

  it('keeps the compact secondary rail navigable after opening a section', () => {
    renderControlledDeck({ panelCollapsed: true, railCollapsed: true })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 3 pages' }))
    expect(secondaryPanel().getByRole('navigation', { name: 'Sidebar navigation' })).toHaveAttribute('data-collapsed', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toBeInTheDocument()
    expect(desktopRail().queryByText('Driving')).toBeNull()
  })

  it('highlights the active section on the rail while the panel is docked away', () => {
    renderDeck({ pathname: '/drives', activeSectionTitle: 'Driving' })
    expect(desktopRail().getByRole('button', { name: 'Driving, 3 pages' })).toHaveAttribute('aria-pressed', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving, 3 pages' })).toHaveAttribute('aria-expanded', 'false')
    expect(desktopRail().getByRole('button', { name: 'Home, 1 pages' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows recents beside suggestions without a second search field', () => {
    renderControlledDeck({
      pathname: '/',
      recentItems: [tripsItem],
      suggestions: [{ ...alertsItem, reason: '1 need attention', kind: 'now' as const }],
    })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Suggested' }))
    expect(secondaryPanel().getByText('Recently Used')).toBeInTheDocument()
    // Recently Used starts collapsed so suggestions own the first paint.
    expect(secondaryPanel().queryByRole('link', { name: 'Trips' })).not.toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Show recently used' }))
    expect(secondaryPanel().getByRole('link', { name: 'Trips' })).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('combobox', { name: 'Search pages' })).not.toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: /All Notifications/ })).toHaveTextContent('1 need attention')
  })

  it('groups suggestions into Now and Up next with pin actions', () => {
    const onPin = vi.fn()
    renderControlledDeck({
      suggestions: [
        { ...alertsItem, reason: '1 need attention', kind: 'now' as const },
        { ...tripsItem, reason: 'Related to Drives', kind: 'related' as const },
      ],
      onPin,
    })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Suggested' }))
    expect(secondaryPanel().getByText('Now')).toBeInTheDocument()
    expect(secondaryPanel().getByText('Up next')).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: /Trips/ })).toHaveTextContent('Related to Drives')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pin Trips to favorites' }))
    expect(onPin).toHaveBeenCalledWith('/trips')
  })

  it('unpins from the favorites view', () => {
    const onUnpin = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onUnpin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Saved' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Unpin Drives' }))
    expect(onUnpin).toHaveBeenCalledWith('/drives')
  })

  it('pins on double-click without unpinning a page that is already saved', () => {
    const onPin = vi.fn()
    const onUnpin = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onPin, onUnpin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 3 pages' }))
    fireEvent.doubleClick(secondaryPanel().getByRole('link', { name: 'Trips' }))
    expect(onPin).toHaveBeenCalledWith('/trips')
    expect(onPin).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(secondaryPanel().getByRole('link', { name: 'Drives' }))
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onUnpin).not.toHaveBeenCalled()
  })

  it('drills rail into panel with Back on mobile', () => {
    renderDeck({ collections: [tripCollection] })
    expect(screen.getByTestId('command-deck-mobile-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('command-deck-mobile-panel')).toBeNull()

    fireEvent.click(mobileRail().getByRole('button', { name: 'Driving, 4 pages' }))
    expect(screen.queryByTestId('command-deck-mobile-rail')).toBeNull()
    expect(mobilePanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(mobilePanel().getByText('Trip Records')).toBeInTheDocument()

    fireEvent.click(mobilePanel().getByRole('button', { name: 'Back to sections' }))
    expect(screen.getByTestId('command-deck-mobile-rail')).toBeInTheDocument()
    expect(mobileRail().queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(screen.queryByTestId('command-deck-mobile-panel')).toBeNull()
  })

  it.each(['All pages', 'Alerts', 'Display'])(
    'closes the mobile drawer for the %s rail shortcut',
    async (label) => {
      const onItemSelect = vi.fn()
      renderControlledDeck({ onItemSelect })
      await act(async () => {
        fireEvent.click(mobileRail().getByRole('link', { name: label }))
      })
      expect(onItemSelect).toHaveBeenCalledTimes(1)
    },
  )

  it('closes the mobile drill level on Escape while leaving the desktop panel untouched', () => {
    const onItemSelect = vi.fn()
    renderControlledDeck({ onItemSelect })
    fireEvent.click(mobileRail().getByRole('button', { name: 'Suggested' }))
    fireEvent.keyDown(mobilePanel().getByRole('navigation', { name: 'Sidebar navigation' }), { key: 'Escape' })
    expect(onItemSelect).toHaveBeenCalledTimes(1)
  })

  it('keeps the desktop panel open when a link is followed, resets mobile levels', async () => {
    const onItemSelect = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onItemSelect })

    fireEvent.click(desktopRail().getByRole('button', { name: 'Saved' }))
    await act(async () => {
      fireEvent.click(secondaryPanel().getByRole('link', { name: 'Drives' }))
    })
    expect(onItemSelect).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('command-deck-secondary')).toBeInTheDocument()

    fireEvent.click(mobileRail().getByRole('button', { name: 'Saved' }))
    await act(async () => {
      fireEvent.click(mobilePanel().getByRole('link', { name: 'Drives' }))
    })
    expect(onItemSelect).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('command-deck-mobile-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('command-deck-mobile-panel')).toBeNull()
  })

  it('persists the selection across mounts', () => {
    const first = renderControlledDeck()
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 3 pages' }))
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')
    first.unmount()

    renderControlledDeck({ activeSectionTitle: 'Home' })
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
    expect(mobileRail().getByRole('button', { name: 'Home, 1 pages' })).toHaveAttribute('aria-pressed', 'true')
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')
  })

  it('replaces a retired search preference with the current section', () => {
    window.localStorage.setItem('teslasync-deck-view', '{"kind":"search"}')
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving' })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving, 3 pages' }))
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
    expect(desktopRail().getByRole('button', { name: 'Driving, 3 pages' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('follows the current section when the route changes while the panel is open', () => {
    const props = baseProps({ pathname: '/drives', activeSectionTitle: 'Driving', panelOpen: true })
    const { rerender } = render(
      <MemoryRouter>
        <CommandDeck {...props} />
      </MemoryRouter>,
    )
    fireEvent.click(desktopRail().getByRole('button', { name: 'Saved' }))
    rerender(
      <MemoryRouter>
        <CommandDeck {...props} pathname="/" activeSectionTitle="Home" />
      </MemoryRouter>,
    )
    expect(desktopRail().getByRole('button', { name: 'Home, 1 pages' })).toHaveAttribute('aria-expanded', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving, 3 pages' })).toHaveAttribute('aria-pressed', 'false')
    expect(secondaryPanel().getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('degrades instead of crashing on undefined props', () => {
    renderDeck({ sections: undefined, pinnedItems: undefined } as unknown as Partial<CommandDeckProps>)
    expect(desktopRail().getByRole('button', { name: 'Suggested' })).toBeInTheDocument()
  })
})
