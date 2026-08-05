import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ClimateState } from '@/types/vehicle-systems';

const mocks = vi.hoisted(() => ({
  climate: [0, 5, 10].map((minutes, index) => ({
    timestamp: new Date(Date.UTC(2026, 7, 5, 8, minutes)).toISOString(),
    insideTemp: 22 - index * 0.5,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: true,
  })) satisfies ClimateState[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: () => ({
    data: mocks.climate,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { temperature: '°C' },
    formatDuration: () => '—',
  }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div>Vehicle picker</div>,
}));
vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ChartContainer: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  ChartTooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import ComfortConsistencyPage from './ComfortConsistencyPage';

describe('ComfortConsistencyPage', () => {
  it('renders canonical boolean HVAC history without a runtime error', () => {
    render(
      <MemoryRouter>
        <ComfortConsistencyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Comfort Consistency' }))
      .toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText(/trim is not a function/i)).not.toBeInTheDocument();
  });
});
