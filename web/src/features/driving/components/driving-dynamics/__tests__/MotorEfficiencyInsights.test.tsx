/**
 * MotorEfficiencyInsights — temperature-suffix + MetricBar regression.
 *
 * Pre-fix bugs surfaced by the user's screenshot of /driving:
 *   1. Avg / Max Motor Temp rendered with a literal '°' prefix BEFORE
 *      the unit pref string (which already includes '°'). Result:
 *      "49.0°°C" instead of "49.0°C". TempUnit prop type was a bare
 *      `string` so the issue couldn't be caught at compile-time.
 *   2. The Throttle Behavior panel passed `sublabel=""` to MetricBar to
 *      suppress the value readout. MetricBar used `sublabel || ...`
 *      which treats the empty string as falsy and fell through to
 *      `fmtNumber(0)` — rendering a stray "0.00" beneath the
 *      Conservative pill.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import MotorEfficiencyInsights from '../MotorEfficiencyInsights'
import type { MotorStats } from '../helpers'

// The panel now owns its data via the shared useMotorStats hook and derives
// the throttle style itself (getThrottleStyle is covered by helpers.test.ts),
// so the hook is stubbed and driven from `mockMotorStats`.
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

import { vi } from 'vitest'

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
  totalReadings: 100,
  avgTorque: 50,
  maxTorque: 200,
  avgMotorTemp: 49,
  maxMotorTemp: 64,
  avgPower: 0,
  peakPower: 0,
  minPower: 0,
  peakRegen: 0,
  highTorquePct: 10,
}

function renderInsights(opts: {
  stats?: MotorStats | null
  tempUnit?: '°C' | '°F'
  toTemperatureDisplay?: (v: number) => number
} = {}) {
  mockMotorStats = opts.stats === undefined ? baseStats : opts.stats
  return render(
    <MotorEfficiencyInsights
      vehicleId={1}
      toTemperatureDisplay={opts.toTemperatureDisplay ?? ((v) => v)}
      tempUnit={opts.tempUnit ?? '°C'}
    />,
  )
}

describe('MotorEfficiencyInsights — temperature suffix never doubles °', () => {
  it('renders "49.0°C" for °C preference (no double degree)', () => {
    renderInsights({ tempUnit: '°C' })
    expect(screen.getByText('49.0°C')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('renders "64.0°C" for max temp under °C preference', () => {
    renderInsights({ tempUnit: '°C' })
    expect(screen.getByText('64.0°C')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('renders "120.2°F" for °F preference using the converter (no double degree)', () => {
    // 49°C = 120.2°F (9/5 + 32)
    renderInsights({
      tempUnit: '°F',
      toTemperatureDisplay: (c) => (c * 9) / 5 + 32,
    })
    expect(screen.getByText('120.2°F')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('whole-page DOM contains zero "°°" anywhere (regression guard)', () => {
    const { container } = renderInsights({ tempUnit: '°C' })
    expect(container.textContent).not.toMatch(/°°/)
  })
})

describe('MotorEfficiencyInsights — Throttle Behavior MetricBar suppression', () => {
  it('does NOT render a stray "0.00" near the Conservative pill (sublabel="" honoured)', () => {
    const { container } = renderInsights({
      stats: { ...baseStats, avgPower: 0 },
      style: 'conservative',
    })

    // The "Avg Power" label is present (with its own "0.0 kW" value)
    // — that's the legitimate readout. The MetricBar should NOT add a
    // second textual "0.00" because we explicitly pass sublabel="".
    expect(screen.getByText('Avg Power')).toBeInTheDocument()
    expect(screen.getByText('0.0 kW')).toBeInTheDocument()

    // "0.00" was the pre-fix bug: MetricBar's `sublabel || fmtNumber(value)`
    // fell through on empty string and rendered fmtNumber(0) = "0.00".
    expect(screen.queryByText('0.00')).toBeNull()
    expect(container.textContent).not.toMatch(/0\.00/)
  })

  it('still renders a non-zero stray "0.00" only when the page genuinely has 0.00 (sanity)', () => {
    // Negative control: with avgPower=12.5 the panel shows "12.5 kW"
    // but no "0.00" (the bar uses sublabel="" so no fallback).
    const { container } = renderInsights({
      stats: { ...baseStats, avgPower: 12.5 },
      style: 'conservative',
    })
    expect(screen.getByText('12.5 kW')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\b0\.00\b/)
  })
})
