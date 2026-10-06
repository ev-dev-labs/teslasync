import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Drive } from '@/types/driving';
import { ToastProvider } from '@/components/feedback';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  distance: 'km' as 'km' | 'mi',
  hook: vi.fn(),
  query: {
    data: undefined as Drive[] | undefined,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    isError: false,
    error: null as Error | null,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const text = typeof fallback === 'string' ? fallback : key;
        return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
          options?.[name] == null ? '' : String(options[name]));
      },
      i18n: { language: 'en-US' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (vehicleId?: string) => {
    h.hook(vehicleId);
    return h.query;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: h.distance, speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'h', power: 'kW', precision: 1, locale: 'en-US',
    },
    formatDistance: (value: number) => h.distance === 'mi'
      ? `${(value / 1609.344).toFixed(1)} mi`
      : `${(value / 1000).toFixed(1)} km`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(1)} kWh`,
  }),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import RangeSimulatorPage from '../../pages/RangeSimulatorPage';

function drive(id: number): Drive {
  return {
    id, vehicleId: 7, startTs: '2026-07-01T08:00:00Z', endTs: null,
    durationS: 3600, distanceM: 50_000,
    startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 80, endBatteryPct: 66, energyUsedWh: 7500,
    regenEnergyWh: null, avgSpeedMps: 20, maxSpeedMps: 33,
    avgPowerW: null, outsideTempAvgC: 18, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: '', updatedAt: '',
  };
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ToastProvider><RangeSimulatorPage /></ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.distance = 'km';
  Object.assign(h.query, {
    data: Array.from({ length: 20 }, (_, index) => drive(index + 1)),
    isLoading: false, isFetching: false, isSuccess: true,
    isError: false, error: null, dataUpdatedAt: 1,
  });
});
afterEach(cleanup);

describe('Range Simulator canonical presentation preservation', () => {
  it('keeps calibrated pack, quantiles, odds, trial count and both interactive controls', () => {
    mount();
    const summary = screen.getByRole('region', { name: 'Simulation summary metrics' });
    expect(within(summary).getByText('100%')).toBeInTheDocument();
    expect(within(summary).getByText('34%')).toBeInTheDocument();
    expect(within(summary).getByText('P10 34% · P90 34%')).toBeInTheDocument();
    expect(within(summary).getByText('53.6 kWh')).toBeInTheDocument();
    expect(within(summary).getByText('2000')).toBeInTheDocument();
    expect(within(summary).getByText('from 20 real drives')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Trip distance' })).toHaveValue('200');
    expect(screen.getByRole('slider', { name: 'Starting battery' })).toHaveValue('90');
    expect(screen.getByRole('heading', { name: 'Arrival Battery Distribution' })).toBeInTheDocument();
    expect(h.hook).toHaveBeenCalledWith('7');

    fireEvent.change(screen.getByRole('slider', { name: 'Trip distance' }), { target: { value: '100' } });
    expect(within(summary).getByText('62%')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Starting battery' }), { target: { value: '80' } });
    expect(within(summary).getByText('52%')).toBeInTheDocument();
  });

  it('retains calculated evidence, controls and chart through a cached refresh failure', () => {
    h.query.error = new Error('Cached history refresh failed');
    h.query.isError = true;
    h.query.isSuccess = false;
    mount();
    const warning = screen.getByTestId('stale-refresh-warning');
    const summary = screen.getByRole('region', { name: 'Simulation summary metrics' });
    expect(within(summary).getByText('34%')).toBeInTheDocument();
    expect(within(summary).getByText('53.6 kWh')).toBeInTheDocument();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Histogram of simulated arrival battery/ })).toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: /refresh/i }));
    expect(h.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps uncalibratable history unknown while preserving plan controls and the distribution shell', () => {
    h.query.data = [drive(1)];
    mount();
    const summary = screen.getByRole('region', { name: 'Simulation summary metrics' });
    expect(within(summary).queryByText('0%')).not.toBeInTheDocument();
    expect(within(summary).queryByText('0 kWh')).not.toBeInTheDocument();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Arrival Battery Distribution' })).toBeInTheDocument();
    expect(screen.getByText(/Not enough history yet/)).toBeInTheDocument();
  });

  it('converts only the display distance while retaining the same real history', () => {
    h.distance = 'mi';
    mount();
    expect(screen.getByRole('slider', { name: 'Trip distance' })).toHaveAttribute('aria-valuetext', '200 mi');
    expect(h.hook).toHaveBeenCalledWith('7');
    expect(screen.getByText('53.6 kWh')).toBeInTheDocument();
    expect(h.query.data).toHaveLength(20);
  });
});
