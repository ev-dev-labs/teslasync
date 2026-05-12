import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { UptimeHeatmap, type UptimeDay } from '../UptimeHeatmap'

function days(n: number, statuses?: UptimeDay['status'][]): UptimeDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    status: statuses?.[i] ?? 'healthy',
  }))
}

describe('UptimeHeatmap', () => {
  it('renders one square per day', () => {
    render(<UptimeHeatmap days={days(30)} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(30)
  })

  it('shows 100% uptime when every day is healthy', () => {
    render(<UptimeHeatmap days={days(30)} />)
    expect(screen.getByText(/100\.00% uptime/)).toBeInTheDocument()
  })

  it('drops the uptime % when one day is unhealthy', () => {
    const ds = days(30)
    ds[15] = { date: ds[15]!.date, status: 'unhealthy' }
    render(<UptimeHeatmap days={ds} />)
    // 29/30 healthy
    expect(screen.getByText(/96\.67% uptime/)).toBeInTheDocument()
  })

  it('treats maintenance as healthy for uptime purposes', () => {
    const ds = days(10)
    ds[5] = { date: ds[5]!.date, status: 'maintenance' }
    render(<UptimeHeatmap days={ds} />)
    expect(screen.getByText(/100\.00% uptime/)).toBeInTheDocument()
  })

  it('exposes per-day aria labels', () => {
    const ds = days(3, ['healthy', 'degraded', 'unhealthy'])
    render(<UptimeHeatmap days={ds} />)
    expect(screen.getByLabelText('2026-01-01: Operational')).toBeInTheDocument()
    expect(screen.getByLabelText('2026-01-02: Degraded')).toBeInTheDocument()
    expect(screen.getByLabelText('2026-01-03: Outage')).toBeInTheDocument()
  })

  it('uses the default title with the day count', () => {
    render(<UptimeHeatmap days={days(7)} />)
    expect(screen.getByText('Uptime — last 7 days')).toBeInTheDocument()
  })

  it('honours a custom title', () => {
    render(<UptimeHeatmap days={days(7)} title="Quarterly heat" />)
    expect(screen.getByText('Quarterly heat')).toBeInTheDocument()
  })
})
