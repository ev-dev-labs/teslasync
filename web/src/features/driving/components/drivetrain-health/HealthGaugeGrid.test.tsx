/**
 * HealthGaugeGrid — behavioural + hardening contract.
 *
 * HealthGaugeGrid is a purely presentational three-panel grid: a health-score
 * radial gauge, a motor-details KV list, and a drive-statistics KV list. Every
 * data source has independent loading / empty / populated branches, so these
 * tests pin each branch plus the SI→display unit conversion at the render
 * boundary.
 *
 * What this suite pins:
 *   - Populated: gauge value + description, motor KV list, sensor count, and
 *     the SI→display conversion of distance/speed (real @/lib/unitConversion).
 *   - Unit branch: flipping unitPrefs km→mi / km/h→mph re-labels + re-scales.
 *   - Health-status label is i18n-keyed (`drivetrain.health.<status>`) rather
 *     than a raw capitalised enum — matches the HealthOverview convention.
 *   - Empty branches: `hasHealth=false` shows two health empty states and the
 *     stats panel shows its own empty state; all are `role="status"` regions.
 *   - Loading branches: health `loading` and stats `statsLoading` render
 *     skeletons and hide their content, while panel titles stay visible.
 *   - Null-safety: `sensors=undefined` must not throw (sensor count → 0).
 *   - a11y: the decorative "real-time" icon is `aria-hidden`.
 *
 * The component reads unit prefs via useUnits (mocked to a deterministic bag)
 * and i18n via useTranslation (stubbed to echo the fallback string). No
 * network is involved — the component takes all data through props.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// Shared, mutable test doubles hoisted above the vi.mock factories.
const h = vi.hoisted(() => {
  const t = vi.fn((key: string, fallbackOrOpts?: unknown): string => {
    if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
    if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
      const o = fallbackOrOpts as Record<string, unknown>
      if (typeof o.defaultValue === 'string') return o.defaultValue
    }
    return key
  })
  // Default preference bag — a single test flips distance/speed to imperial.
  const prefs = {
    distance: 'km',
    speed: 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: undefined as number | undefined,
  }
  return { t, prefs }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: h.t,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// The component reads only `unitPrefs`; the real unit-conversion lib runs so
// assertions exercise genuine SI→display math. Formatters are echoed for
// shape parity with the real useUnits return value.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: h.prefs,
    formatDistance: (v: number | null | undefined) => String(v ?? 0),
    formatSpeed: (v: number | null | undefined) => String(v ?? 0),
    formatTemperature: (v: number | null | undefined) => String(v ?? 0),
    formatPressure: (v: number | null | undefined) => String(v ?? 0),
    formatEnergy: (v: number | null | undefined) => String(v ?? 0),
    formatDuration: (v: number | null | undefined) => String(v ?? 0),
    formatPower: (v: number | null | undefined) => String(v ?? 0),
  }),
}))

import { HealthGaugeGrid } from './HealthGaugeGrid'
import type { TempSensor } from './constants'
import type { DrivingStats } from '@/types/driving'

type Props = ComponentProps<typeof HealthGaugeGrid>

function sensor(overrides: Partial<TempSensor> = {}): TempSensor {
  return {
    key: 'frontMotor',
    labelKey: 'drivetrain.frontMotor',
    defaultLabel: 'Front Motor',
    value: 42,
    maxTemp: 150,
    color: '#06b6d4',
    icon: null,
    ...overrides,
  }
}

const baseStats: DrivingStats = {
  totalDrives: 42,
  totalDistanceKm: 8000,
  totalDurationS: 3600,
  avgEfficiencyWhKm: 150,
  avgSpeedKmh: 10,
  topSpeedKmh: 25,
  regenRatio: 0.2,
  regenEnergyWh: 500,
  co2SavedKg: 30,
}

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    overallHealth: 'good',
    healthScore: 88,
    motorStatus: 'Nominal',
    sensors: [
      sensor({ key: 'a', value: 42 }),
      sensor({ key: 'b', value: 55 }),
      sensor({ key: 'c', value: null }),
    ],
    stats: baseStats,
    hasHealth: true,
    loading: false,
    statsLoading: false,
    ...overrides,
  }
}

beforeEach(() => {
  h.t.mockClear()
  h.prefs.distance = 'km'
  h.prefs.speed = 'km/h'
})

describe('HealthGaugeGrid — populated', () => {
  it('renders the health-score gauge, description and both panel titles', () => {
    render(<HealthGaugeGrid {...makeProps()} />)

    // Radial gauge renders the integer score (88) and its caption.
    expect(screen.getByText('88')).toBeInTheDocument()
    expect(screen.getByText('Overall drivetrain condition rating')).toBeInTheDocument()
    // Panel titles are always present regardless of data state.
    expect(screen.getByText('Motor Details')).toBeInTheDocument()
    expect(screen.getByText('Drive Statistics')).toBeInTheDocument()
  })

  it('renders motor details with an i18n-keyed health label and the non-null sensor count', () => {
    render(<HealthGaugeGrid {...makeProps({ overallHealth: 'warning' })} />)

    expect(screen.getByText('Motor Status')).toBeInTheDocument()
    expect(screen.getByText('Nominal')).toBeInTheDocument()
    expect(screen.getByText('Overall Health')).toBeInTheDocument()
    // Status label comes through the i18n key, not a raw capitalised enum.
    expect(screen.getByText('Warning')).toBeInTheDocument()
    expect(h.t).toHaveBeenCalledWith('drivetrain.health.warning', 'Warning')
    // Only 2 of the 3 sensors have a non-null value.
    expect(screen.getByText('Active Sensors')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    // Decorative live-telemetry caption.
    expect(screen.getByText('Real-time telemetry active')).toBeInTheDocument()
  })

  it('converts SI drive stats to the km / km·h⁻¹ display preference', () => {
    render(<HealthGaugeGrid {...makeProps()} />)

    expect(screen.getByText('Total Drives')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    // 8000 m → 8 km
    expect(screen.getByText('8 km')).toBeInTheDocument()
    // 10 m/s → 36.0 km/h, 25 m/s → 90.0 km/h
    expect(screen.getByText('36.0 km/h')).toBeInTheDocument()
    expect(screen.getByText('90.0 km/h')).toBeInTheDocument()
  })

  it('re-labels and re-scales drive stats when the preference is imperial', () => {
    h.prefs.distance = 'mi'
    h.prefs.speed = 'mph'
    render(
      <HealthGaugeGrid
        {...makeProps({
          stats: { ...baseStats, totalDistanceKm: 3218.688, avgSpeedKmh: 10, topSpeedKmh: 25 },
        })}
      />,
    )

    // 3218.688 m → 2 mi (exact: 2 × 1609.344).
    expect(screen.getByText('2 mi')).toBeInTheDocument()
    // Both speed rows now carry the mph suffix.
    const mphCells = screen.getAllByText((content) => content.includes('mph'))
    expect(mphCells).toHaveLength(2)
    // The km suffix must be gone from the speed rows.
    expect(screen.queryByText('36.0 km/h')).toBeNull()
  })
})

describe('HealthGaugeGrid — empty states', () => {
  it('shows two health empty states and a stats empty state as status regions', () => {
    render(
      <HealthGaugeGrid {...makeProps({ hasHealth: false, stats: undefined, statsLoading: false })} />,
    )

    // Gauge + motor panels both surface the health empty message.
    expect(screen.getAllByText('No drivetrain health data available yet')).toHaveLength(2)
    // Stats panel surfaces its own empty message.
    expect(screen.getByText('No drive statistics available yet')).toBeInTheDocument()
    // All three empty states are announced as status regions.
    expect(screen.getAllByRole('status')).toHaveLength(3)
    // Populated content must be absent.
    expect(screen.queryByText('Overall drivetrain condition rating')).toBeNull()
    expect(screen.queryByText('Real-time telemetry active')).toBeNull()
    // Panel titles remain.
    expect(screen.getByText('Motor Details')).toBeInTheDocument()
  })

  it('shows the stats empty state while the health panels stay populated', () => {
    render(
      <HealthGaugeGrid {...makeProps({ stats: undefined, statsLoading: false })} />,
    )

    expect(screen.getByText('Overall drivetrain condition rating')).toBeInTheDocument()
    expect(screen.getByText('No drive statistics available yet')).toBeInTheDocument()
    expect(screen.queryByText('Total Drives')).toBeNull()
  })
})

describe('HealthGaugeGrid — loading states', () => {
  it('renders health skeletons and hides content while loading, keeping titles', () => {
    const { container } = render(<HealthGaugeGrid {...makeProps({ loading: true })} />)

    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    // Gauge + motor content is replaced by skeletons.
    expect(screen.queryByText('Overall drivetrain condition rating')).toBeNull()
    expect(screen.queryByText('Motor Status')).toBeNull()
    // Titles persist so layout doesn't jump.
    expect(screen.getByText('Motor Details')).toBeInTheDocument()
  })

  it('renders a stats skeleton (not an empty state) while stats are loading', () => {
    const { container } = render(
      <HealthGaugeGrid {...makeProps({ stats: undefined, statsLoading: true })} />,
    )

    expect(screen.getByText('Drive Statistics')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText('No drive statistics available yet')).toBeNull()
    expect(screen.queryByText('Total Drives')).toBeNull()
  })
})

describe('HealthGaugeGrid — hardening', () => {
  it('does not throw and reports a zero sensor count when sensors is undefined', () => {
    expect(() =>
      render(
        <HealthGaugeGrid {...makeProps({ sensors: undefined as unknown as TempSensor[] })} />,
      ),
    ).not.toThrow()

    expect(screen.getByText('Active Sensors')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('marks the decorative real-time icon as aria-hidden', () => {
    const { container } = render(<HealthGaugeGrid {...makeProps()} />)
    // The lucide "Activity" icon is presentational and hidden from AT.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })
})
