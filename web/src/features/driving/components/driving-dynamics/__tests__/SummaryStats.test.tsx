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
  it('renders "49.0°C" not "49.0°°C" for °C preference', () => {
    const { container } = render(
      <SummaryStats
        motorStats={baseStats}
        toTemperatureDisplay={(v) => v}
        tempUnit="°C"
      />,
    )
    expect(screen.getByText('49.0°C')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('renders "120.2°F" not "120.2°°F" for °F preference', () => {
    const { container } = render(
      <SummaryStats
        motorStats={baseStats}
        toTemperatureDisplay={(c) => (c * 9) / 5 + 32}
        tempUnit="°F"
      />,
    )
    expect(screen.getByText('120.2°F')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('renders "—" placeholder when motorStats is null (no temp suffix at all)', () => {
    const { container } = render(
      <SummaryStats
        motorStats={null}
        toTemperatureDisplay={(v) => v}
        tempUnit="°C"
      />,
    )
    // Multiple "—" placeholders in the panel — assert at least one present.
    expect(container.textContent).toContain('—')
    expect(container.textContent).not.toMatch(/°°/)
  })
})
