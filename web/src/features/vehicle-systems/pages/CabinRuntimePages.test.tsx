import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ClimateState } from '@/types/vehicle-systems';

const mocks = vi.hoisted(() => ({
  climate: Array.from({ length: 12 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 7, 5, 8, index * 10)).toISOString(),
    insideTemp: 20 + 20 * Math.exp(-(index * 10) / 90),
    outsideTemp: 20,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: index === 0,
    isAcOn: false,
    fanSpeed: index === 0 ? 2 : 0,
  })) satisfies ClimateState[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? _key),
    i18n: { language: 'en-US', changeLanguage: vi.fn() },
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
    unitPrefs: { temperature: '°C', duration: 'h' },
    formatDuration: () => '10 min',
    formatTemperature: (value: number) => `${value} °C`,
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
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import CabinThermalPage from './CabinThermalPage';
import HvacCyclingPage from './HvacCyclingPage';

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe('cabin analytics runtime pages', () => {
  it('renders HVAC Cycling with canonical boolean HVAC history', () => {
    renderPage(<HvacCyclingPage />);

    expect(screen.getByRole('heading', { name: 'HVAC Cycling' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hourly HVAC Duty' })).toBeInTheDocument();
  });

  it('renders Cabin Thermal Model with canonical boolean HVAC history', () => {
    renderPage(<CabinThermalPage />);

    expect(screen.getByRole('heading', { name: 'Cabin Thermal Model' })).toBeInTheDocument();
    expect(screen.getByText('Accepted median τ')).toBeInTheDocument();
  });
});
