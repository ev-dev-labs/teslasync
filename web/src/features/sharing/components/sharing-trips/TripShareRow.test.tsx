/**
 * TripShareRow tests.
 *
 * TripShareRow is a presentation-only listbox option: it renders one recent
 * trip and delegates selection to an `onSelect(id)` callback the parent owns.
 * These tests pin the behaviour that matters:
 *
 *   1. Content — name, formatted start date, duration, drive count, and the
 *      distance/energy values produced by the injected SI formatters render.
 *   2. SI boundary — distance/energy are handed to the formatters as the raw
 *      meters / watt-hours off the trip (never pre-converted), and whatever the
 *      formatter returns (including its "—" placeholder for missing data) is
 *      what shows.
 *   3. Selection — clicking the row fires `onSelect` with the trip id, and the
 *      `selected` prop drives `aria-selected` so status is not colour-only.
 *   4. Null-safety + a11y — a null, empty, or whitespace-only name degrades to a
 *      stable "Trip #<id>" label (visible title AND the option's accessible
 *      name), a missing drive count folds to "0 drives", and the option is a
 *      real keyboard-operable button.
 *
 * The real i18n bundle is loaded (`@/i18n`) so translated labels and the
 * `{{count}}` interpolation resolve exactly as they do in the app. The repo does
 * not depend on `@testing-library/user-event`, so `fireEvent` drives the click —
 * matching the other component tests here. No network or provider is required:
 * the row only consumes `useTranslation` plus the formatter callbacks passed in.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'

import { TripShareRow } from './TripShareRow'
import type { Trip } from '@/api/types'
import type { UnitFormatter } from '@/hooks/useUnits'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 7,
    vehicle_id: 1,
    name: 'Coastal Road Trip',
    start_date: '2026-06-15T12:00:00Z',
    end_date: '2026-06-15T14:30:00Z',
    started_at: '2026-06-15T12:00:00Z',
    ended_at: '2026-06-15T14:30:00Z',
    total_distance_m: 42200,
    total_energy_wh: 9800,
    total_duration_s: 5400,
    total_cost: 12.5,
    drive_count: 3,
    charge_count: 1,
    created_at: '2026-06-15T15:00:00Z',
    ...overrides,
  }
}

const defaultDistance: UnitFormatter = (v) => (v == null ? '—' : `${v} km`)
const defaultEnergy: UnitFormatter = (v) => (v == null ? '—' : `${v} Wh`)

interface RenderOpts {
  trip?: Trip
  selected?: boolean
  onSelect?: (id: number) => void
  formatDistance?: UnitFormatter
  formatEnergy?: UnitFormatter
}

function renderRow(opts: RenderOpts = {}) {
  const trip = opts.trip ?? makeTrip()
  const onSelect = opts.onSelect ?? vi.fn()
  const formatDistance = opts.formatDistance ?? vi.fn(defaultDistance)
  const formatEnergy = opts.formatEnergy ?? vi.fn(defaultEnergy)

  const element = (t: Trip, selected: boolean) => (
    <ul>
      <TripShareRow
        trip={t}
        selected={selected}
        onSelect={onSelect}
        formatDistance={formatDistance}
        formatEnergy={formatEnergy}
      />
    </ul>
  )

  const utils = render(element(trip, opts.selected ?? false))
  const rerenderWith = (t: Trip, selected: boolean) => utils.rerender(element(t, selected))
  return { ...utils, trip, onSelect, formatDistance, formatEnergy, rerenderWith }
}

describe('TripShareRow', () => {
  it('renders the name, date, duration, drive count, distance, and energy', () => {
    const { formatDistance, formatEnergy, trip } = renderRow()

    // Name — both the visible title and the option's accessible name.
    expect(screen.getByText('Coastal Road Trip')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Coastal Road Trip' })).toBeInTheDocument()

    // Metric chips: formatted start date (year is timezone-stable), the SI
    // duration aggregate rendered compactly, and the pluralised drive count.
    expect(screen.getByText(/2026/)).toBeInTheDocument()
    expect(screen.getByText('1h 30m')).toBeInTheDocument()
    expect(screen.getByText('3 drives')).toBeInTheDocument()

    // Distance + energy flow through the injected formatters, called with the
    // raw meters / watt-hours off the trip — the SI display boundary.
    expect(formatDistance).toHaveBeenCalledWith(trip.total_distance_m)
    expect(formatEnergy).toHaveBeenCalledWith(trip.total_energy_wh)
    expect(screen.getByText('42200 km')).toBeInTheDocument()
    expect(screen.getByText('9800 Wh')).toBeInTheDocument()
  })

  it('fires onSelect with the trip id when the row is clicked', () => {
    const onSelect = vi.fn()
    renderRow({ onSelect, trip: makeTrip({ id: 99 }) })

    fireEvent.click(screen.getByRole('option'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(99)
  })

  it('reflects selection through aria-selected and stays a keyboard-operable button', () => {
    const { rerenderWith, trip } = renderRow({ selected: false })

    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'false')
    // SelectableCard renders a real <button>, so focus + keyboard come for free.
    expect(option.tagName).toBe('BUTTON')

    rerenderWith(trip, true)
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  })

  it('falls back to "Trip #<id>" when the name is null', () => {
    renderRow({ trip: makeTrip({ id: 42, name: null }) })

    expect(screen.getByText('Trip #42')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Trip #42' })).toBeInTheDocument()
  })

  it('falls back to "Trip #<id>" for an empty or whitespace-only name', () => {
    const { rerenderWith } = renderRow({ trip: makeTrip({ id: 5, name: '' }) })

    // Empty string must not slip through and blank out the title/aria-label.
    expect(screen.getByText('Trip #5')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Trip #5' })).toBeInTheDocument()

    rerenderWith(makeTrip({ id: 5, name: '   ' }), false)
    expect(screen.getByRole('option', { name: 'Trip #5' })).toBeInTheDocument()
  })

  it('is null-safe for a missing drive count, rendering "0 drives"', () => {
    renderRow({ trip: makeTrip({ drive_count: undefined as unknown as number }) })

    expect(screen.getByText('0 drives')).toBeInTheDocument()
  })

  it('passes missing distance/energy straight to the formatters and shows their placeholder', () => {
    const formatDistance = vi.fn(defaultDistance)
    const formatEnergy = vi.fn(defaultEnergy)
    renderRow({
      trip: makeTrip({
        total_distance_m: undefined as unknown as number,
        total_energy_wh: undefined as unknown as number,
      }),
      formatDistance,
      formatEnergy,
    })

    // The row never guards to 0 — it hands the raw (missing) SI value over so
    // the formatter can render the correct em-dash placeholder.
    expect(formatDistance).toHaveBeenCalledWith(undefined)
    expect(formatEnergy).toHaveBeenCalledWith(undefined)
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('derives the duration from timestamps when the aggregate is absent', () => {
    // total_duration_s = 0 forces the start/end delta path in tripDurationSeconds.
    renderRow({
      trip: makeTrip({
        total_duration_s: 0,
        start_date: '2026-06-15T12:00:00Z',
        end_date: '2026-06-15T13:15:00Z',
      }),
    })

    expect(screen.getByText('1h 15m')).toBeInTheDocument()
  })
})
