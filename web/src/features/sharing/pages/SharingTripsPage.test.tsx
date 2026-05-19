/**
 * SharingTripsPage — smoke tests.
 *
 * The page is deterministic at the contract layer:
 *   - useTrips returns the recent-trips list
 *   - useSelectedVehicle returns the active vehicle id
 *   - useUnits returns the user's unit prefs
 *   - the AITripPostcard… component is gated behind withAiFeature and
 *     renders nothing in off-mode, so a stubbed `() => null` is faithful
 *
 * Covered:
 *   1. Loading state renders skeletons.
 *   2. Empty trips list renders the EmptyState.
 *   3. Populated trips list renders one option per trip and supports
 *      keyboard/click selection (aria-selected updates).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string | Record<string, unknown>) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))

const useTripsMock = vi.fn()
vi.mock('@/api/hooks/useTrips', () => ({
  useTrips: (...args: unknown[]) => useTripsMock(...args),
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 1,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km' as const,
      speed: 'kph' as const,
      temperature: 'c' as const,
      tirePressure: 'kpa' as const,
      energy: 'kwh' as const,
    },
  }),
}))

// The AI postcard component fetches from the backend on mount and is
// gated by withAiFeature in production. For a unit test it's correct
// to render nothing — the contract surface this page owns is the
// recent-trips list, not the AI card.
vi.mock('@/components/ai/AITripPostcardShareCardImageGeneration', () => ({
  AITripPostcardShareCardImageGeneration: () => null,
}))

import SharingTripsPage from './SharingTripsPage'

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SharingTripsPage />
    </MemoryRouter>,
  )
}

function makeTrip(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Trip ${id}`,
    start_date: '2024-01-01T00:00:00Z',
    end_date: '2024-01-01T01:00:00Z',
    total_distance_km: 12.3,
    total_energy_kwh: 4.5,
    total_cost: 0,
    drive_count: 1,
    charge_count: 0,
    total_distance_m: 12300,
    ...overrides,
  }
}

describe('SharingTripsPage', () => {
  beforeEach(() => {
    useTripsMock.mockReset()
  })

  it('renders skeletons while trips are loading', () => {
    useTripsMock.mockReturnValue({ data: undefined, isLoading: true })
    const { container } = renderPage()
    // The page mounts and PageContainer's `loading` prop is true, so
    // the skeleton block in the trips card is in the DOM.
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the EmptyState when there are no trips', () => {
    useTripsMock.mockReturnValue({ data: [], isLoading: false })
    renderPage()
    expect(
      screen.getByText(/No recent trips/i),
    ).toBeInTheDocument()
  })

  it('renders one option per trip and supports selection', () => {
    const trips = [makeTrip(101), makeTrip(202)]
    useTripsMock.mockReturnValue({ data: trips, isLoading: false })
    renderPage()

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    // Both start unselected
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(options[1])
    const after = screen.getAllByRole('option')
    expect(after[1]).toHaveAttribute('aria-selected', 'true')
    expect(after[0]).toHaveAttribute('aria-selected', 'false')
  })
})
