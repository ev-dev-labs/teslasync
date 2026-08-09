import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle } from '@/types/vehicle'

const {
  useVehiclesMock,
  useSelectedVehicleMock,
  setVehicleIdMock,
  refetchMock,
} = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useSelectedVehicleMock: vi.fn(),
  setVehicleIdMock: vi.fn(),
  refetchMock: vi.fn(),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: useVehiclesMock,
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: useSelectedVehicleMock,
}))

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}))

vi.mock('../components/vehicle-management', () => ({
  VehicleManagementWorkspace: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="vehicle-management-workspace">
      {vehicleId ? `management:${vehicleId}` : 'management:no-vehicle'}
    </div>
  ),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  )
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        if (typeof fallback !== 'string') return key
        if (!options || typeof options !== 'object') return fallback
        const values = options as Record<string, unknown>
        return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
          String(values[name] ?? `{{${name}}}`),
        )
      },
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import VehicleManagementPage from './VehicleManagementPage'

function makeVehicle(id: number, name: string): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `5YJ3E1EA0PF00000${id}`,
    display_name: name,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-08-08T20:00:00Z',
    updated_at: '2026-08-08T20:00:00Z',
  }
}

function installHooks({
  vehicles,
  selected = vehicles?.[0] ?? null,
  loading = false,
  error = null,
}: {
  vehicles?: Vehicle[]
  selected?: Vehicle | null
  loading?: boolean
  error?: Error | null
}) {
  useVehiclesMock.mockReturnValue({
    data: vehicles,
    isLoading: loading,
    error,
    refetch: refetchMock,
  })
  useSelectedVehicleMock.mockReturnValue({
    vehicleId: selected?.id ?? null,
    vehicle: selected,
    vehicles: vehicles ?? [],
    setVehicleId: setVehicleIdMock,
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/vehicle-management']}>
      <VehicleManagementPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('VehicleManagementPage', () => {
  it('renders a standalone selected-vehicle workspace', () => {
    const first = makeVehicle(1, 'Roadster')
    const second = makeVehicle(2, 'Cybertruck')
    installHooks({ vehicles: [first, second], selected: second })

    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Vehicle Management' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:2',
    )
    expect(screen.queryByText('Vehicle Command Center')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Select management vehicle')).toHaveValue('2')
  })

  it('updates persistent vehicle selection from the route-level picker', () => {
    const first = makeVehicle(1, 'Roadster')
    const second = makeVehicle(2, 'Cybertruck')
    installHooks({ vehicles: [first, second], selected: first })

    renderPage()
    fireEvent.change(screen.getByLabelText('Select management vehicle'), {
      target: { value: '2' },
    })

    expect(setVehicleIdMock).toHaveBeenCalledWith(2)
  })

  it('keeps the workspace visible while the fleet loads', () => {
    installHooks({ vehicles: undefined, selected: null, loading: true })

    renderPage()

    expect(screen.getByText('Loading vehicle context')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
  })

  it('keeps account-level management visible on roster error and retries', () => {
    installHooks({
      vehicles: undefined,
      selected: null,
      error: new Error('fleet unavailable'),
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('Vehicle context unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders an honest empty-fleet state without hiding endpoint cards', () => {
    installHooks({ vehicles: [], selected: null })

    renderPage()

    expect(screen.getByText('No vehicles available')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
  })
})
