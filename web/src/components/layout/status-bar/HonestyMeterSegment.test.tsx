import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HonestyMeterSegment } from './HonestyMeterSegment'
import { StatusBarProvider } from './StatusBarContext'

const fixture = vi.hoisted(() => ({
  status: 'connected' as 'connected' | 'reconnecting' | 'disconnected' | 'unknown',
  lastMessageAt: new Date().toISOString() as string | null,
  condition: 'live',
  vehicles: [{ id: 1, display_name: 'M3' }],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? Object.entries(opts).reduce((out, [k, v]) => out.replace(new RegExp(`{{${k}}}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), String(v)), fallback)
        : fallback,
  }),
}))

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({ status: fixture.status, lastMessageAt: fixture.lastMessageAt }),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: fixture.vehicles }),
  useFleetStates: () => ({ data: [{ vehicle: { id: 1 } }], summary: null }),
  describeFleetState: () => ({ condition: fixture.condition }),
}))

describe('HonestyMeterSegment', () => {
  beforeEach(() => {
    fixture.status = 'connected'
    fixture.lastMessageAt = new Date().toISOString()
    fixture.condition = 'live'
    fixture.vehicles = [{ id: 1, display_name: 'M3' }]
  })

  it('renders live count from fleet posture', () => {
    render(
      <MemoryRouter>
        <StatusBarProvider announcementLabel="status">
          <HonestyMeterSegment />
        </StatusBarProvider>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Telemetry honesty meter')).toBeInTheDocument()
    expect(screen.getByText(/Fleet/)).toHaveTextContent('Fleet · 1/1')
    expect(screen.getByRole('link', { name: 'Telemetry honesty meter' })).not.toHaveTextContent('Live')
    expect(screen.getByRole('link', { name: 'Telemetry honesty meter' }).querySelector('.lucide-gauge')).not.toBeNull()
  })

  it.each([
    ['stale', 'stale', '--semantic-warning'],
    ['pending', 'guessed', '--semantic-info'],
    ['unknown', 'missing', '--text-secondary'],
  ])('retains %s posture and measured zero live count', (condition, label, tone) => {
    fixture.condition = condition
    render(<MemoryRouter><HonestyMeterSegment /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Telemetry honesty meter' })
    expect(link).toHaveTextContent(`${label} · 0/1`)
    expect(link).toHaveClass(`text-[var(${tone})]`)
    expect(link).toHaveAttribute('href', '/')
  })

  it('keeps icon-only navigation named and decorative gauge hidden', () => {
    render(<MemoryRouter><HonestyMeterSegment iconOnly /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Telemetry honesty meter' })
    expect(link).toHaveAttribute('href', '/')
    expect(link).toHaveTextContent('')
    expect(link.querySelector('.lucide-gauge')).toHaveAttribute('aria-hidden', 'true')
    expect(link).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-offset-2')
  })

  it.each([
    ['connected', 119_000, 'Fleet'],
    ['connected', 120_000, 'stale'],
    ['reconnecting', 0, 'guessed'],
    ['unknown', 0, 'missing'],
    ['disconnected', 0, 'missing'],
  ] as const)('preserves %s stream honesty at age %i without a fleet denominator', (status, age, label) => {
    fixture.vehicles = []
    fixture.status = status
    fixture.lastMessageAt = new Date(Date.now() - age).toISOString()
    render(<MemoryRouter><HonestyMeterSegment /></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Telemetry honesty meter' })
    expect(link).toHaveTextContent(label)
    expect(link).not.toHaveTextContent('0/0')
  })
})
