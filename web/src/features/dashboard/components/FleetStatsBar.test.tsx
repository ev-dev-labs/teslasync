/**
 * FleetStatsBar — behavioural coverage + hardening regression tests.
 *
 * FleetStatsBar is the pure-presentation fleet KPI strip on the dashboard.
 * It receives already-fetched data as props (no network of its own), converts
 * distance/efficiency through injected display-unit functions, and renders
 * five labelled metric tiles with count-up numbers plus two sparklines.
 *
 * Coverage:
 *   1. Full-data render — every tile, label, unit suffix, the online caption,
 *      the two sparklines, and that the injected converters receive the RAW
 *      base values (total_distance_km, avg_efficiency_wh_km), not display units.
 *   2. Undefined analytics / recent data — panels still render (no hidden
 *      sections), converters fall back to 0, and no sparkline is drawn.
 *   3. The unread-alerts colour branch (red when > 0, emerald when 0).
 *   4. Regression: a recent drive missing `distance_m` must NOT poison the
 *      sparkline with NaN points — the `?? 0` element guard.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FleetStatsBar } from './FleetStatsBar'
import type { FleetAnalytics, Drive, ChargingSession } from '../types'

// Passthrough i18n stub: return the English default so tiles render their
// human labels without booting the full i18n resource bundle. Ignores the
// namespace argument (the component calls useTranslation('dashboard')).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}))

const analytics: FleetAnalytics = {
  total_vehicles: 3,
  total_drives: 10,
  total_charging_sessions: 5,
  total_distance_km: 1000,
  total_energy_kwh: 250,
  total_cost: 0,
  avg_efficiency_wh_km: 160,
  period_days: 30,
}

const drives = [
  { distance_m: 3000 },
  { distance_m: 5000 },
  { distance_m: 4000 },
] as Drive[]

const charges = [
  { total_energy_added_wh: 12000 },
  { total_energy_added_wh: 8000 },
  { total_energy_added_wh: 15000 },
] as ChargingSession[]

interface Overrides {
  analytics?: FleetAnalytics | undefined
  vehicleCount?: number
  onlineCount?: number
  unreadAlerts?: number
  recentDrives?: Drive[] | undefined
  recentCharges?: ChargingSession[] | undefined
  distanceUnit?: string
  efficiencyUnit?: string
}

function renderBar(overrides: Overrides = {}) {
  const toDistanceDisplay = vi.fn((km: number) => km * 0.621371)
  const toEfficiencyDisplay = vi.fn((whKm: number) => whKm)
  const utils = render(
    <FleetStatsBar
      analytics={'analytics' in overrides ? overrides.analytics : analytics}
      vehicleCount={overrides.vehicleCount ?? 3}
      onlineCount={overrides.onlineCount ?? 2}
      unreadAlerts={overrides.unreadAlerts ?? 4}
      recentDrives={'recentDrives' in overrides ? overrides.recentDrives : drives}
      recentCharges={'recentCharges' in overrides ? overrides.recentCharges : charges}
      toDistanceDisplay={toDistanceDisplay}
      toEfficiencyDisplay={toEfficiencyDisplay}
      distanceUnit={overrides.distanceUnit ?? 'mi'}
      efficiencyUnit={overrides.efficiencyUnit ?? 'Wh/mi'}
    />,
  )
  return { ...utils, toDistanceDisplay, toEfficiencyDisplay }
}

describe('FleetStatsBar', () => {
  it('renders all five labelled tiles with units, captions, and both sparklines', () => {
    const { container, toDistanceDisplay, toEfficiencyDisplay } = renderBar()

    // Every metric label is visible.
    expect(screen.getByText('Fleet Size')).toBeInTheDocument()
    expect(screen.getByText('Distance (30d)')).toBeInTheDocument()
    expect(screen.getByText('Energy (30d)')).toBeInTheDocument()
    expect(screen.getByText('Efficiency')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()

    // Five labelled groups — a11y grouping applied to each tile.
    expect(screen.getAllByRole('group')).toHaveLength(5)

    // Converters receive the RAW base values (km / Wh-per-km), not display units.
    expect(toDistanceDisplay).toHaveBeenCalledWith(1000)
    expect(toEfficiencyDisplay).toHaveBeenCalledWith(160)

    // Unit suffixes surface inside the correct tiles.
    expect(screen.getByRole('group', { name: 'Distance (30d)' })).toHaveTextContent('mi')
    expect(screen.getByRole('group', { name: 'Energy (30d)' })).toHaveTextContent('kWh')
    expect(screen.getByRole('group', { name: 'Efficiency' })).toHaveTextContent('Wh/mi')

    // Online + static captions.
    expect(screen.getByRole('group', { name: 'Fleet Size' })).toHaveTextContent('online')
    expect(screen.getByText('fleet average')).toBeInTheDocument()
    expect(screen.getByText('unread')).toBeInTheDocument()

    // Two sparklines: one for drives, one for charges.
    expect(container.querySelectorAll('polyline')).toHaveLength(2)
  })

  it('renders every panel and falls converters back to 0 when analytics and recent data are undefined', () => {
    const { container, toDistanceDisplay, toEfficiencyDisplay } = renderBar({
      analytics: undefined,
      vehicleCount: 0,
      onlineCount: 0,
      recentDrives: undefined,
      recentCharges: undefined,
      distanceUnit: 'km',
      efficiencyUnit: 'Wh/km',
    })

    // No section is hidden — all five tiles still render with a nil dataset.
    expect(screen.getAllByRole('group')).toHaveLength(5)
    expect(screen.getByText('Efficiency')).toBeInTheDocument()

    // Nullish analytics → converters invoked with 0 (never undefined/NaN).
    expect(toDistanceDisplay).toHaveBeenCalledWith(0)
    expect(toEfficiencyDisplay).toHaveBeenCalledWith(0)

    // With <2 data points MiniChart draws nothing rather than crashing.
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })

  it('colours the alert count red when there are unread alerts and emerald when there are none', () => {
    const withAlerts = renderBar({ unreadAlerts: 4 })
    const alertsWith = screen.getByRole('group', { name: 'Alerts' })
    expect(alertsWith.querySelector('.text-red-500')).not.toBeNull()
    expect(alertsWith.querySelector('.text-emerald-500')).toBeNull()
    withAlerts.unmount()

    renderBar({ unreadAlerts: 0 })
    const alertsNone = screen.getByRole('group', { name: 'Alerts' })
    expect(alertsNone.querySelector('.text-emerald-500')).not.toBeNull()
    expect(alertsNone.querySelector('.text-red-500')).toBeNull()
  })

  it('guards a recent drive missing distance_m so the sparkline never renders NaN points', () => {
    const holed = [
      { distance_m: 3000 },
      { distance_m: undefined as unknown as number },
      { distance_m: 4000 },
    ] as Drive[]
    const { container } = renderBar({ recentDrives: holed })

    const polylines = container.querySelectorAll('polyline')
    expect(polylines.length).toBeGreaterThanOrEqual(1)
    polylines.forEach((line) => {
      expect(line.getAttribute('points') ?? '').not.toContain('NaN')
    })
  })
})
