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
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils'

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
    expect(screen.getByText('49.00°C')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('renders "64.0°C" for max temp under °C preference', () => {
    renderInsights({ tempUnit: '°C' })
    expect(screen.getByText('64.00°C')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('renders "120.2°F" for °F preference using the converter (no double degree)', () => {
    // 49°C = 120.2°F (9/5 + 32)
    renderInsights({
      tempUnit: '°F',
      toTemperatureDisplay: (c) => (c * 9) / 5 + 32,
    })
    expect(screen.getByText('120.20°F')).toBeInTheDocument()
    expect(screen.queryByText(/°°/)).toBeNull()
  })

  it('whole-page DOM contains zero "°°" anywhere (regression guard)', () => {
    const { container } = renderInsights({ tempUnit: '°C' })
    expect(container.textContent).not.toMatch(/°°/)
  })
})

describe('MotorEfficiencyInsights — Throttle Behavior MetricBar suppression', () => {
  it.each(PACK_IDS)('%s composes measured motor definitions without changing source values or units', pack => {
    mockMotorStats = {
      ...baseStats, avgTorque: 0, maxTorque: -20, avgPower: -2, peakRegen: -3,
      avgMotorTemp: 0, maxMotorTemp: null, highTorquePct: null,
    }
    const before = JSON.stringify(mockMotorStats)
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <MotorEfficiencyInsights vehicleId={1} toTemperatureDisplay={c => c * 9 / 5 + 32} tempUnit="°F" />
      </div>,
    )
    const host = container.firstElementChild!
    const release = observeAppDesignScopes(host)
    try {
      const definitions = host.querySelectorAll('[data-app-list="definitions"]')
      expect(definitions).toHaveLength(3)
      const rows = host.querySelectorAll('[data-app-list="definitions"] > [data-app-part~="list-row"]')
      expect(rows).toHaveLength(8)
      for (const row of rows) {
        expectAppDesignDataMode(row, APPLICATION_DESIGNS[pack].data, '[data-app-list="definitions"]')
        expect(matchesAppDesignCss(row, `[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`)
          .some(match => match.declarations.display != null)).toBe(true)
        expect(row.querySelector('dt[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement()
        expect(row.querySelector('dd[data-app-part~="metric-value"]')).not.toBeEmptyDOMElement()
      }
      expect(within(definitions[0] as HTMLElement).getByText('0.00 Nm')).toBeInTheDocument()
      expect(within(definitions[0] as HTMLElement).getByText('-20.00 Nm')).toBeInTheDocument()
      expect(within(definitions[1] as HTMLElement).getByText('-2.00 kW')).toBeInTheDocument()
      expect(within(definitions[1] as HTMLElement).getByText('-3.00 kW')).toBeInTheDocument()
      expect(within(definitions[2] as HTMLElement).getByText('32.00°F')).toBeInTheDocument()
      expect(within(definitions[2] as HTMLElement).getByText('—')).toBeInTheDocument()
      expect(host).toHaveTextContent('Sample share is not time spent under load or a driver rating.')
      expect(host).toHaveTextContent('Power alone cannot classify driving style.')
      expect(host).toHaveTextContent('Temperature alone does not establish thermal limiting or powertrain health.')
      expect(JSON.stringify(mockMotorStats)).toBe(before)
    } finally { release() }
  })

  it('owns measured definitions while preserving zero, signed power, and independent absent groups', () => {
    const { container, rerender } = renderInsights({
      stats: { ...baseStats, avgTorque: 0, avgPower: -2, peakRegen: -3, avgMotorTemp: null },
    })
    const lists = container.querySelectorAll('[data-app-list="definitions"]')
    expect(lists).toHaveLength(2)
    expect(lists[0].tagName).toBe('DL')
    expect(lists[0].querySelectorAll('dt')).toHaveLength(3)
    expect(within(lists[0] as HTMLElement).getByText('0.00 Nm')).toBeInTheDocument()
    expect(within(lists[1] as HTMLElement).getByText('-2.00 kW')).toBeInTheDocument()
    expect(within(lists[1] as HTMLElement).getByText('-3.00 kW')).toBeInTheDocument()
    expect(screen.getByText('No motor data recorded yet')).toBeInTheDocument()
    expect(screen.getByText(/Power alone cannot classify driving style/)).toBeInTheDocument()
    mockMotorStats = null
    rerender(<MotorEfficiencyInsights vehicleId={1} toTemperatureDisplay={v => v} tempUnit="°C" />)
    expect(container.querySelector('[data-app-list="definitions"]')).toBeNull()
    expect(screen.getAllByText('No motor data recorded yet')).toHaveLength(3)
  })

  it('does NOT render a stray "0.00" near the Conservative pill (sublabel="" honoured)', () => {
    renderInsights({
      stats: { ...baseStats, avgPower: 0 },
    })

    // The "Avg Power" label is present (with its own "0.0 kW" value)
    // — that's the legitimate readout. The MetricBar should NOT add a
    // second textual "0.00" because we explicitly pass sublabel="".
    expect(screen.getByText('Avg Power')).toBeInTheDocument()
    expect(screen.getAllByText('0.00 kW')).toHaveLength(3)

    // "0.00" was the pre-fix bug: MetricBar's `sublabel || fmtNumber(value)`
    // fell through on empty string and rendered fmtNumber(0) = "0.00".
    expect(screen.queryByText('0.00')).toBeNull()
    expect(screen.queryByText('Conservative')).toBeNull()
  })

  it('still renders a non-zero stray "0.00" only when the page genuinely has 0.00 (sanity)', () => {
    // Negative control: with avgPower=12.5 the panel shows "12.5 kW"
    // but no "0.00" (the bar uses sublabel="" so no fallback).
    renderInsights({
      stats: { ...baseStats, avgPower: 12.5 },
    })
    expect(screen.getByText('12.50 kW')).toBeInTheDocument()
    expect(screen.queryByText('0.00')).toBeNull()
  })
})
