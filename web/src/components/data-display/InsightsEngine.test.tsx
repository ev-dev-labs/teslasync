import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightsEngine } from './InsightsEngine'

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) =>
      `$${Number(amount).toFixed(decimals)}`,
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    currencySymbol: '$',
    costPerKwh: 0.12,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}))

describe('InsightsEngine', () => {
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
