/**
 * SummaryStats — temperature-suffix regression.
 *
 * Pre-fix: the "Avg Motor Temp" stat card rendered "49.0°°C" because
 * the component prefixed a literal '°' before the unit string while
 * `unitPrefs.temperature` already includes '°'. The tempUnit prop was
 * typed as `string` so the bug couldn't be caught at compile-time;
 * post-fix the prop is narrowed to TemperatureUnitPref ('°C' | '°F').
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import SummaryStats from '../SummaryStats'
import type { MotorStats } from '../helpers'

// SummaryStats now owns its data via useMotorStats (shared, deduped
// ['motor-history', …] query) instead of receiving a prop from the page, so
// the aggregate KPIs refresh as new telemetry lands. The aggregation itself
// is covered by helpers.test.ts; this suite still only pins the rendering, so
// the hook is stubbed and driven from `mockMotorStats`.
let mockMotorStats: MotorStats | null = null

vi.mock('../useMotorStats', () => ({
  MOTOR_HISTORY_LIMIT: 200,
  useMotorStats: () => ({
    motorStats: mockMotorStats,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

const baseStats: MotorStats = {
  totalReadings: 3451,
  avgTorque: 72.4,
  maxTorque: 2284,
  avgMotorTemp: 49,
  maxMotorTemp: 64,
  avgPower: 0,
  peakPower: 0,
  minPower: 0,
  peakRegen: 0,
  highTorquePct: 32.4,
}

describe('SummaryStats — temperature suffix', () => {
  function renderStats(
    motorStats: MotorStats | null,
    toTemperatureDisplay: (v: number) => number,
    tempUnit: '°C' | '°F',
  ) {
    mockMotorStats = motorStats
    return render(
      <SummaryStats
        vehicleId={1}
        toTemperatureDisplay={toTemperatureDisplay}
        tempUnit={tempUnit}
      />,
    )
  }

  it('renders "49.0°C" not "49.0°°C" for °C preference', () => {
    const { container } = renderStats(baseStats, (v) => v, '°C')
    expect(screen.getByText('49.0°C')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('renders "120.2°F" not "120.2°°F" for °F preference', () => {
    const { container } = renderStats(baseStats, (c) => (c * 9) / 5 + 32, '°F')
    expect(screen.getByText('120.2°F')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('renders "—" placeholder when motorStats is null (no temp suffix at all)', () => {
    const { container } = renderStats(null, (v) => v, '°C')
    // Multiple "—" placeholders in the panel — assert at least one present.
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toMatch(/°°/)
  })
})
