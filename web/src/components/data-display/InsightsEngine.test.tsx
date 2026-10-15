import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { InsightsEngine } from './InsightsEngine'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => {
    const { fmtNumber } = useNumberFormatting()
    return {
      formatCurrency: (amount: number, decimals?: number) => `$${fmtNumber(amount, decimals)}`,
      formatEnergyCost: (kwh: number) => `$${fmtNumber(kwh * 0.12)}`,
      currencySymbol: '$',
      costPerKwh: 0.12,
      costPerDistanceUnit: () => null,
      estimateGasCost: () => null,
    }
  },
}))

describe('InsightsEngine', () => {
  it('refreshes memoized insights for the same data while preserving counts and severity', () => {
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
    const data = {
      chargingSessions: [
        { cost: 1.23456, charge_energy_added: 1 },
        { cost: 1.23456, charge_energy_added: 1 },
      ],
      vampireDrainStats: { avg_drain_pct_per_day: 3.4567, p95_drain_pct_per_day: 4.5678, event_count: 1234 },
    }
    const { container } = render(<InsightsEngine data={data as never} />)
    expect(screen.getByText('Your average charging cost is $1.23/kWh.')).toBeInTheDocument()
    expect(screen.getByText(/3.46% per day; P95 is 4.57% across 1,234 observed windows/)).toBeInTheDocument()
    const classes = container.innerHTML.match(/border[^"]*/g)
    act(() => setGlobalPrecision(3))
    expect(screen.getByText('Your average charging cost is $1.235/kWh.')).toBeInTheDocument()
    expect(screen.getByText(/3.457% per day; P95 is 4.568% across 1,234 observed windows/)).toBeInTheDocument()
    expect(container.innerHTML.match(/border[^"]*/g)).toEqual(classes)
  })
  it('renders nothing with empty data', () => {
    const { container } = render(<InsightsEngine data={{}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing with insufficient drive data', () => {
    const { container } = render(
      <InsightsEngine data={{ drives: [{ distance: 50 } as never] }} />
    )
    // Fewer than 3 drives means no driving-patterns insight, fewer than 4 means no efficiency-trend
    expect(container.innerHTML).toBe('')
  })

  it('renders insights heading when enough data provided', () => {
    const drives = Array.from({ length: 5 }, (_, i) => ({
      id: i,
      distance: 50 + i * 10,
      start_range_km: 300 - i * 20,
      end_range_km: 250 - i * 20,
      start_date: new Date(2024, 0, i + 1).toISOString(),
    })) as never[]

    render(<InsightsEngine data={{ drives }} />)
    expect(screen.getByText('Smart Insights')).toBeInTheDocument()
  })
})
