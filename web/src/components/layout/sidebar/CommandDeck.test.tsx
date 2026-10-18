/**
 * CommandDeck tests.
 *
 * The Command Deck is viewport-driven navigation: an icon section rail
 * (every parent group, always compact, no hub shortcuts, no counts) plus
 * the Atlas secondary panel. Desktop (≥1280px) docks the panel beside
 * the rail; tablet (768–1279px) overlays it as a modal drawer; phone
 * (<768px) swaps the rail for a bottom tab bar with a More grid and a
 * section sheet.
 *
 * Suggested / Saved / All pages live in the Home panel, not on the rail.
 * Pinned and Recent rows live in per-section Pinned / Recent groups whose
 * expansion persists under `teslasync-sidenav-collapsed-groups`.
 *
 * Panel-open state is host-owned (Layout derives the aside width from
 * it), so interaction tests use a small controlled harness below while
 * static tests render the component directly.
 *
 * jsdom defaults to a 1024px viewport (tablet), so every test pins
 * `window.innerWidth` before rendering — desktop by default, with
 * responsive tests opting into their own width.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Icons } from '@/lib/icons'
import type { SectionGroup } from '../sectionGroups'
import CommandDeckDefault, { CommandDeck, type CommandDeckProps } from './CommandDeck'

const motionPreference = vi.hoisted(() => ({ reduce: false, durationMs: 250 }))
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => motionPreference,
}))

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
    panelOpen: false,
    onPanelOpenChange: vi.fn(),
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
    return (
      <MemoryRouter initialEntries={[props.pathname]}>
        <CommandDeck {...props} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen} />
      </MemoryRouter>
    )
  }
  return render(<Harness />)
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const desktopRail = () => within(screen.getByTestId('command-deck-rail'))
const secondaryPanel = () => within(screen.getByTestId('command-deck-secondary'))
const dialogPanel = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  setViewportWidth(1920)
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.removeAttribute('dir')
  motionPreference.reduce = false
  motionPreference.durationMs = 250
  vi.restoreAllMocks()
})

describe('CommandDeck', () => {
  it('exports the component as both a named and default export', () => {
    expect(CommandDeckDefault).toBe(CommandDeck)
  })

  it('lists sections without counts on the rail and hub shortcuts with counts in the Home panel', () => {
    renderControlledDeck({
      pinnedItems: [drivesItem],
      suggestions: [{ ...tripsItem, reason: 'Related to Drives', kind: 'related' as const }],
      alertCount: 3,
      vehicleCount: 2,
      collections: [tripCollection],
    })

    expect(desktopRail().queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    expect(desktopRail().getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Home', 'Driving'])
    expect(desktopRail().queryByRole('button', { name: 'Suggested' })).not.toBeInTheDocument()
    expect(desktopRail().queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument()
    expect(desktopRail().queryByRole('button', { name: /pages/ })).not.toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/notifications/inbox')
    expect(desktopRail().queryByRole('link', { name: 'Cars' })).not.toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'Display' })).toHaveAttribute('href', '/settings#appearance')
    expect(desktopRail().getByLabelText('3 unread alerts')).toBeInTheDocument()
    expect(desktopRail().queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
    expect(desktopRail().queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument()

    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    expect(secondaryPanel().getByRole('button', { name: 'Suggested1' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('button', { name: 'Saved1' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'All pages5' })).toHaveAttribute('href', '/explore')

    // Collection expansion still counts pages — now on the panel group header.
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveTextContent('2')
  })

  it('keeps the rail permanently compact with accessible names and no host toggle', () => {
    const onToggleRailCollapsed = vi.fn()
    renderControlledDeck({ onToggleRailCollapsed })

    const driving = desktopRail().getByRole('button', { name: 'Driving' })
    expect(driving).toHaveAttribute('aria-label', 'Driving')
    expect(within(driving).getByText('Driving')).toBeInTheDocument()
    fireEvent.click(driving)
    // The retired collapse prop is accepted for compatibility but never fires.
    expect(onToggleRailCollapsed).not.toHaveBeenCalled()
    expect(desktopRail().queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
    expect(desktopRail().queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument()
    // Accessible names survive panel open/close.
    expect(desktopRail().getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps My Vehicles and its count in the Vehicles section, not the primary shortcuts', () => {
    const sections = [
      ...makeSections(),
      { title: 'Vehicles', titleKey: 'nav.groups.vehicles', items: [{ to: '/vehicles', icon: Icons.vehicle, label: 'My Vehicles', labelKey: 'nav.items.vehicles' }] },
    ]
    renderControlledDeck({ sections, vehicleCount: 2 })

    expect(desktopRail().queryByRole('link', { name: 'Cars' })).not.toBeInTheDocument()
    expect(desktopRail().queryByLabelText('2 vehicles')).not.toBeInTheDocument()
    fireEvent.click(desktopRail().getByRole('button', { name: 'Vehicles' }))
    const vehiclesLink = secondaryPanel().getByRole('link', { name: /My Vehicles/ })
    expect(vehiclesLink).toHaveAttribute('href', '/vehicles')
    expect(within(vehiclesLink).getByLabelText('2 vehicles')).toBeInTheDocument()
  })

  it('exposes every rail label through a hover-and-focus tooltip', () => {
    renderControlledDeck({ suggestions: [{ ...tripsItem, reason: 'Related', kind: 'related' as const }] })

    const driving = desktopRail().getByRole('button', { name: 'Driving' })
    const tip = document.getElementById(driving.getAttribute('aria-describedby') ?? '')
    expect(tip).toHaveAttribute('role', 'tooltip')
    expect(tip).toHaveTextContent('Driving')
    expect(tip).not.toHaveTextContent('pages')
    // One affordance for pointer and keyboard: hidden at rest, revealed by
    // hover or focus.
    expect(tip).toHaveClass('opacity-0', 'group-hover/tip:opacity-100', 'group-focus-within/tip:opacity-100')

    // Keyboard focus gets the same affordance as hover: Escape dismisses the
    // bubble while focused, and either focus or hover re-arms it.
    act(() => { driving.focus() })
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(tip).toHaveClass('!opacity-0')
    act(() => { driving.blur() })
    act(() => { driving.focus() })
    expect(tip).not.toHaveClass('!opacity-0')
    fireEvent.mouseEnter(driving.parentElement!)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(tip).toHaveClass('!opacity-0')
  })

  it('keeps tooltips hidden at rest while labels are visible', () => {
    renderControlledDeck({})
    for (const button of desktopRail().getAllByRole('button')) {
      expect(within(button).getByText(button.getAttribute('aria-label')!)).toBeInTheDocument()
      const tip = document.getElementById(button.getAttribute('aria-describedby') ?? '')
      expect(tip).toHaveClass('opacity-0')
      expect(tip).not.toHaveClass('!opacity-0')
    }
  })

  it('docks the secondary panel to a group and collapses it on re-press', () => {
    renderControlledDeck({ collections: [tripCollection] })
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()

    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')

    // The active primary item is itself a collapse control.
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
  })

  it('collapses a collection without removing its pages or moving pinned pages', () => {
    const onPin = vi.fn()
    renderControlledDeck({ collections: [tripCollection], onPin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
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
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('button', { name: 'Drive Records' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'true')
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

  it('opens every collection by default, highlights the active page, and shows collapsed counts', () => {
    renderControlledDeck({ pathname: '/drive-calendar', collections: [driveCollection, tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    const driveGroup = secondaryPanel().getByRole('button', { name: 'Drive Records' })
    const tripGroup = secondaryPanel().getByRole('button', { name: 'Trip Records' })
    expect(driveGroup).toHaveAttribute('aria-expanded', 'true')
    expect(tripGroup).toHaveAttribute('aria-expanded', 'true')
    expect(tripGroup).toHaveTextContent('2')
    expect(secondaryPanel().getByRole('link', { name: 'Drive Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    fireEvent.click(tripGroup)
    expect(tripGroup).toHaveAttribute('aria-expanded', 'false')
    expect(tripGroup).toHaveTextContent('2')
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(tripGroup)
    expect(tripGroup).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
  })

  it('filters only the open section and retains group controls and clear', () => {
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving', collections: [driveCollection, tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    const filter = secondaryPanel().getByRole('searchbox', { name: 'Filter Driving pages' })
    fireEvent.change(filter, { target: { value: 'mile' } })
    expect(secondaryPanel().getByRole('button', { name: 'Trip Records' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('link', { name: 'Drive Calendar' })).not.toBeInTheDocument()
    expect(secondaryPanel().getByRole('button', { name: 'Collapse all groups' })).toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'Drive Records' } })
    expect(secondaryPanel().getByRole('link', { name: 'Drive Calendar' })).toBeInTheDocument()
    fireEvent.change(filter, { target: { value: 'not-a-page' } })
    expect(secondaryPanel().getByRole('status')).toHaveTextContent('No pages match "not-a-page".')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    expect(filter).toHaveValue('')
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
  })

  it('moves real pinned pages into the Pinned group and removes them from either surface', async () => {
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
    const pins = secondaryPanel().getByRole('button', { name: 'Pinned' })
    expect(pins).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByText('Pin a page below to keep it close.')).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pin Trips to favorites' }))
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    // Pin state is reflected on both surfaces: the section row and the Pinned row.
    expect(secondaryPanel().getAllByRole('button', { name: 'Unpin Trips' })).toHaveLength(2)
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
    // Collapsing hides the pins again, but filtering forces them back open so
    // a collapsed match never reads as a missing result.
    fireEvent.click(pins)
    expect(pins).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.change(secondaryPanel().getByRole('searchbox', { name: 'Filter Driving pages' }), { target: { value: 'trips' } })
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    // Non-matching filters scope pins out of the section instead.
    fireEvent.change(secondaryPanel().getByRole('searchbox', { name: 'Filter Driving pages' }), { target: { value: 'no matching pages' } })
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    expect(secondaryPanel().getByRole('status')).toHaveTextContent('No pages match "no matching pages".')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    // Unpinning from the Pinned row clears both surfaces.
    const reopened = secondaryPanel().getByRole('button', { name: 'Pinned' })
    expect(reopened).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(reopened)
    const quickLink = secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })
    fireEvent.click(within(quickLink.parentElement as HTMLElement).getByRole('button', { name: 'Unpin Trips' }))
    await waitFor(() => expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument())
    expect(secondaryPanel().getByText('Pin a page below to keep it close.')).toBeInTheDocument()
    expect(secondaryPanel().getByRole('button', { name: 'Pin Trips to favorites' })).toBeInTheDocument()
  })

  it('never duplicates the current page into section quick access', () => {
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving', pinnedItems: [drivesItem, tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Drives' })).not.toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
  })

  it('remembers Pinned and Recent expansion across remounts without opening filtered groups permanently', () => {
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
    const pins = secondaryPanel().getByRole('button', { name: 'Pinned' })
    expect(pins).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    fireEvent.click(pins)
    expect(pins).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(window.localStorage.getItem('teslasync-sidenav-collapsed-groups') ?? '{}')).toEqual({ 'section:Driving:pinned': true })
    fireEvent.change(secondaryPanel().getByRole('searchbox', { name: 'Filter Driving pages' }), {
      target: { value: 'Trips' },
    })
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'true')
    expect(JSON.parse(window.localStorage.getItem('teslasync-sidenav-collapsed-groups') ?? '{}')).toEqual({ 'section:Driving:pinned': true })
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Clear filter' }))
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    first.unmount()

    render(
      <MemoryRouter initialEntries={['/drives']}>
        <CommandDeck {...props} />
      </MemoryRouter>,
    )
    expect(secondaryPanel().getByRole('button', { name: 'Pinned' })).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().queryByRole('link', { name: 'Quick access: Trips' })).not.toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pinned' }))
    expect(secondaryPanel().getByRole('link', { name: 'Quick access: Trips' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('teslasync-sidenav-collapsed-groups') ?? '{}')).toEqual({ 'section:Driving:pinned': false })

    cleanup()
    renderControlledDeck({ pathname: '/', recentItems: [tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    const recent = secondaryPanel().getByRole('button', { name: 'Recent' })
    expect(recent).toHaveAttribute('aria-expanded', 'true')
    // The Recent row renders beside the section row, not instead of it.
    expect(secondaryPanel().getAllByRole('link', { name: 'Trips' })).toHaveLength(2)
    fireEvent.click(recent)
    expect(recent).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().getAllByRole('link', { name: 'Trips' })).toHaveLength(1)
    cleanup()
    renderControlledDeck({ pathname: '/', recentItems: [tripsItem] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-expanded', 'false')
    expect(secondaryPanel().getAllByRole('link', { name: 'Trips' })).toHaveLength(1)
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Recent' }))
    expect(secondaryPanel().getAllByRole('link', { name: 'Trips' })).toHaveLength(2)
  })

  it('collapses the secondary panel via its header, returning focus to the rail', () => {
    renderControlledDeck()
    const drivingButton = desktopRail().getByRole('button', { name: 'Driving' })

    fireEvent.click(drivingButton)
    fireEvent.keyDown(screen.getByTestId('atlas-panel-secondary'), { key: 'Escape' })
    expect(screen.getByTestId('command-deck-secondary')).toBeInTheDocument()

    // jsdom has no requestAnimationFrame; run the focus callback synchronously.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
    try {
      fireEvent.click(secondaryPanel().getByRole('button', { name: 'Hide panel' }))
      expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
      expect(document.activeElement).toBe(drivingButton)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the secondary panel navigable with always-labeled links (no icon-only collapsed rail)', () => {
    renderControlledDeck({ collections: [tripCollection] })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    // The redesign removed the collapsible icon-only rail: links always carry text.
    expect(secondaryPanel().queryByRole('button', { name: 'Collapse secondary navigation' })).toBeNull()
    expect(secondaryPanel().getByRole('navigation', { name: 'Sidebar navigation' })).not.toHaveAttribute('data-collapsed')
    const mileage = secondaryPanel().getByRole('link', { name: 'Mileage Log' })
    expect(mileage).toHaveTextContent('Mileage Log')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Trip Records' }))
    expect(secondaryPanel().queryByRole('link', { name: 'Mileage Log' })).toBeNull()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Trip Records' }))
    expect(secondaryPanel().getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
  })

  it('ignores the legacy collapse props and opens labeled section links', () => {
    renderControlledDeck({ panelCollapsed: true, railCollapsed: true })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    // Legacy props no longer collapse anything: links render with text.
    expect(secondaryPanel().getByRole('navigation', { name: 'Sidebar navigation' })).not.toHaveAttribute('data-collapsed')
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveTextContent('Drives')
  })

  it('highlights the active section on the rail while the panel is docked away', () => {
    renderDeck({ pathname: '/drives', activeSectionTitle: 'Driving' })
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'false')
    expect(desktopRail().getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('shows suggestions with reasons and in-section recents behind a single search field', () => {
    renderControlledDeck({
      pathname: '/',
      recentItems: [tripsItem],
      suggestions: [{ ...alertsItem, reason: '1 need attention', kind: 'now' as const }],
    })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Suggested1' }))
    expect(secondaryPanel().getByText('Now')).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: /All Notifications/ })).toHaveTextContent('1 need attention')
    expect(secondaryPanel().queryByRole('searchbox')).not.toBeInTheDocument()
    // Recents live beside the section content, not in the suggested view.
    expect(secondaryPanel().queryByText('Recent')).not.toBeInTheDocument()
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Home' }))
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('button', { name: 'Recent' })).toBeInTheDocument()
    expect(secondaryPanel().getAllByRole('link', { name: 'Trips' })).toHaveLength(2)
    expect(secondaryPanel().getAllByRole('searchbox')).toHaveLength(1)
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
    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Suggested2' }))
    expect(secondaryPanel().getByText('Now')).toBeInTheDocument()
    expect(secondaryPanel().getByText('Up next')).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: /Trips/ })).toHaveTextContent('Related to Drives')
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Pin Trips to favorites' }))
    expect(onPin).toHaveBeenCalledWith('/trips')
  })

  it('unpins from the favorites view', () => {
    const onUnpin = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onUnpin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Saved1' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Unpin Drives' }))
    expect(onUnpin).toHaveBeenCalledWith('/drives')
  })

  it('pins on double-click without unpinning a page that is already saved', () => {
    const onPin = vi.fn()
    const onUnpin = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onPin, onUnpin })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    fireEvent.doubleClick(secondaryPanel().getByRole('link', { name: 'Trips' }))
    expect(onPin).toHaveBeenCalledWith('/trips')
    expect(onPin).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(secondaryPanel().getByRole('link', { name: 'Drives' }))
    expect(onPin).toHaveBeenCalledTimes(1)
    expect(onUnpin).not.toHaveBeenCalled()
  })

  it('opens phone tabs into a More grid and a section sheet, dismissed with Escape', () => {
    setViewportWidth(375)
    renderControlledDeck({ collections: [tripCollection] })
    const tabs = within(screen.getByRole('navigation', { name: 'Quick navigation' }))
    expect(tabs.getAllByRole('button')).toHaveLength(5)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(tabs.getByRole('button', { name: 'More' }))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Driving' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Driving' }))
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Mileage Log' })).toBeInTheDocument()
    expect(within(dialog).getByText('Trip Records')).toBeInTheDocument()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Quick navigation' })).toBeInTheDocument()
  })

  it.each(['All pages', 'Alerts', 'Display'])(
    'notifies the host when the %s shortcut is followed',
    async (label) => {
      const onItemSelect = vi.fn()
      renderControlledDeck({ onItemSelect })
      fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
      await act(async () => {
        fireEvent.click(
          label === 'All pages'
            ? secondaryPanel().getByRole('link', { name: /All pages/ })
            : desktopRail().getByRole('link', { name: label }),
        )
      })
      expect(onItemSelect).toHaveBeenCalledTimes(1)
    },
  )

  it('closes the tablet drawer on Escape while keeping the rail selection', () => {
    setViewportWidth(768)
    const onItemSelect = vi.fn()
    renderControlledDeck({ onItemSelect })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(dialogPanel().getByRole('navigation', { name: 'Sidebar navigation' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onItemSelect).toHaveBeenCalledTimes(1)
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'false')

    // Escape from rail focus takes the same path.
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const driving = desktopRail().getByRole('button', { name: 'Driving' })
    act(() => { driving.focus() })
    fireEvent.keyDown(driving, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onItemSelect).toHaveBeenCalledTimes(2)
  })

  it('keeps the desktop panel open when a link is followed, closes the tablet drawer', async () => {
    const onItemSelect = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onItemSelect })

    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Saved1' }))
    await act(async () => {
      fireEvent.click(secondaryPanel().getByRole('link', { name: 'Drives' }))
    })
    expect(onItemSelect).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('command-deck-secondary')).toBeInTheDocument()

    cleanup()
    setViewportWidth(768)
    const onTabletSelect = vi.fn()
    renderControlledDeck({ pinnedItems: [drivesItem], onItemSelect: onTabletSelect })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    await act(async () => {
      fireEvent.click(dialogPanel().getByRole('link', { name: 'Drives' }))
    })
    expect(onTabletSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
  })

  it('persists the selection across mounts', () => {
    const first = renderControlledDeck()
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')
    first.unmount()

    renderControlledDeck({ activeSectionTitle: 'Home' })
    expect(screen.queryByTestId('command-deck-secondary')).toBeNull()
    // The browsed section wins over the route on reload.
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'false')
    expect(desktopRail().getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')
  })

  it('restores a stored section once late-loading sections include it, without overwriting it', () => {
    window.localStorage.setItem('teslasync-deck-view', '{"kind":"section","title":"Driving"}')
    const sections = makeSections()
    const props = baseProps({ pathname: '/drives', activeSectionTitle: 'Home', panelOpen: true })
    const { rerender } = render(
      <MemoryRouter initialEntries={['/drives']}>
        <CommandDeck {...props} sections={sections.filter(section => section.title !== 'Driving')} />
      </MemoryRouter>,
    )
    expect(desktopRail().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')

    rerender(
      <MemoryRouter initialEntries={['/drives']}>
        <CommandDeck {...props} sections={sections} />
      </MemoryRouter>,
    )
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
  })

  it('replaces a retired search preference with the current section', () => {
    window.localStorage.setItem('teslasync-deck-view', '{"kind":"search"}')
    renderControlledDeck({ pathname: '/drives', activeSectionTitle: 'Driving' })
    fireEvent.click(desktopRail().getByRole('button', { name: 'Driving' }))
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toHaveAttribute('aria-current', 'page')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).toHaveAttribute('aria-expanded', 'true')
    expect(window.localStorage.getItem('teslasync-deck-view')).toBe('{"kind":"section","title":"Driving"}')
  })

  it('follows the current section when the route changes while the panel is open', () => {
    const props = baseProps({
      pathname: '/drives',
      activeSectionTitle: 'Driving',
      panelOpen: true,
      suggestions: [{ ...tripsItem, reason: 'Related to Drives', kind: 'related' as const }],
    })
    const { rerender } = render(
      <MemoryRouter>
        <CommandDeck {...props} />
      </MemoryRouter>,
    )
    fireEvent.click(desktopRail().getByRole('button', { name: 'Home' }))
    fireEvent.click(secondaryPanel().getByRole('button', { name: 'Suggested1' }))
    expect(secondaryPanel().getByText('Up next')).toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <CommandDeck {...props} pathname="/" activeSectionTitle="Home" />
      </MemoryRouter>,
    )
    expect(desktopRail().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'true')
    expect(desktopRail().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-expanded', 'true')
    expect(desktopRail().getByRole('button', { name: 'Driving' })).not.toHaveAttribute('aria-current')
    expect(secondaryPanel().getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
  })

  it('degrades instead of crashing on undefined props', () => {
    renderDeck({ sections: undefined, pinnedItems: undefined } as unknown as Partial<CommandDeckProps>)
    expect(desktopRail().getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
    expect(desktopRail().getByRole('link', { name: 'Display' })).toBeInTheDocument()
    expect(desktopRail().queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['ltr', 'rtl'])('renders both panel levels instantly with no entrance transform in %s', (direction) => {
    document.documentElement.dir = direction
    renderDeck({ panelOpen: true })
    // The redesign removed directional entrances: panels render instantly.
    const desktop = screen.getByTestId('command-deck-secondary')
    expect(desktop.style.transform).toBe('')
    expect(desktop.style.filter).toBe('')

    cleanup()
    window.localStorage.clear()
    setViewportWidth(900)
    renderDeck({ panelOpen: true })
    const tablet = screen.getByRole('dialog')
    expect(tablet).toHaveClass('sidenav-tablet-panel')
    expect(tablet.style.transform).toBe('')
    expect(tablet.style.filter).toBe('')
  })

  it('renders both panel levels immediately when the shared motion policy requests reduction', () => {
    motionPreference.reduce = true
    motionPreference.durationMs = 0
    renderDeck({ panelOpen: true })
    expect(screen.getByTestId('command-deck-secondary')).toBeInTheDocument()
    expect(secondaryPanel().getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    const driving = desktopRail().getByRole('button', { name: 'Driving' })
    expect(document.getElementById(driving.getAttribute('aria-describedby') ?? '')).toHaveClass('transition-none')
    fireEvent.click(driving)
    expect(secondaryPanel().getByRole('link', { name: 'Drives' })).toBeInTheDocument()

    cleanup()
    // Isolate the halves: the desktop half above stored Driving as the selection.
    window.localStorage.clear()
    setViewportWidth(768)
    renderDeck({ panelOpen: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialogPanel().getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
