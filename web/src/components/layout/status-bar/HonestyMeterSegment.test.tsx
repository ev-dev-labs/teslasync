import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { HonestyMeterSegment } from './HonestyMeterSegment'
import { StatusBarProvider } from './StatusBarContext'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? Object.entries(opts).reduce((out, [k, v]) => out.replaceAll(`{{${k}}}`, String(v)), fallback)
        : fallback,
  }),
}))

vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({ status: 'connected', lastMessageAt: new Date().toISOString() }),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 1, display_name: 'M3' }] }),
  useFleetStates: () => ({ data: [{ vehicle: { id: 1 } }], summary: null }),
  describeFleetState: () => ({ condition: 'live' }),
}))

describe('HonestyMeterSegment', () => {
  it('renders live count from fleet posture', () => {
    render(
      <MemoryRouter>
        <StatusBarProvider announcementLabel="status">
          <HonestyMeterSegment />
        </StatusBarProvider>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Telemetry honesty meter')).toBeInTheDocument()
    expect(screen.getByText(/Live/)).toBeInTheDocument()
  })
})
