import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import type { Drive } from '@/types/driving';
import type { ClimateState } from '@/types/vehicle-systems';

const mocks = vi.hoisted(() => {
  const departure = Date.UTC(2026, 7, 5, 8);
  return {
    climate: [
      {
        timestamp: new Date(departure - 30 * 60_000).toISOString(),
        insideTemp: 35,
        driverTempSetting: 21,
        passengerTempSetting: 21,
        hvacPower: false,
      },
      {
        timestamp: new Date(departure - 5 * 60_000).toISOString(),
        insideTemp: 24,
        driverTempSetting: 21,
        passengerTempSetting: 21,
        hvacPower: true,
      },
    ],
    drives: [
      {
        id: 1,
        vehicleId: 7,
        startTs: new Date(departure).toISOString(),
        endTs: null,
        durationS: 600,
        distanceM: 1_000,
        startAddress: null,
        endAddress: null,
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
        startBatteryPct: null,
        endBatteryPct: null,
        energyUsedWh: null,
        regenEnergyWh: null,
        avgSpeedMps: null,
        maxSpeedMps: null,
        avgPowerW: null,
        outsideTempAvgC: null,
        insideTempAvgC: null,
        score: null,
        endedStatus: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
  } satisfies { climate: ClimateState[]; drives: Drive[] };
});

function query<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  };
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: () => query(mocks.drives),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: () => query(mocks.climate),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: '°C' } }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div>Vehicle picker</div>,
}));

import PreconditioningEffectivenessPage from './PreconditioningEffectivenessPage';

describe('PreconditioningEffectivenessPage', () => {
  it('renders canonical boolean HVAC history without a runtime error', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <PreconditioningEffectivenessPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Preconditioning Effectiveness' }))
      .toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
