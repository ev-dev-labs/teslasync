import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
  }
});

const state = vi.hoisted(() => ({
  vehicles: {
    data: [
      { id: 1, state: 'online' },
      { id: 2, state: 'online' },
      { id: 3, state: 'asleep' },
      { id: 4, state: 'offline' },
    ] as Array<{ id: number; state: string }> | undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null as Error | null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  },
  analytics: {
    data: {
      total_distance_km: 1234,
      total_energy_kwh: 250,
    } as Record<string, number> | undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null as Error | null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  },
  distance: 'km' as 'km' | 'mi',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? `{{${name}}}`));
    },
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => state.vehicles,
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useFleetAnalytics: vi.fn(() => state.analytics),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: state.distance } }),
}));

import FleetStatsBarWidget, { toDistanceDisplay } from './FleetStatsBarWidget';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';

function renderWidget(cols = 4) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <FleetStatsBarWidget size={{ cols, rows: 2 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.distance = 'km';
  state.vehicles.data = [
    { id: 1, state: 'online' },
    { id: 2, state: 'online' },
    { id: 3, state: 'asleep' },
    { id: 4, state: 'offline' },
  ];
  Object.assign(state.vehicles, { isLoading: false, isPending: false, isError: false, isFetching: false, isStale: false, error: null, dataUpdatedAt: Date.now() });
  state.analytics.data = { total_distance_km: 1234, total_energy_kwh: 250 };
  Object.assign(state.analytics, { isLoading: false, isPending: false, isError: false, isFetching: false, isStale: false, error: null, dataUpdatedAt: Date.now() });
  vi.mocked(useFleetAnalytics).mockClear();
});

afterEach(cleanup);

describe('FleetStatsBarWidget — After card', () => {
  it('renders one four-cell KPI strip with shared units and truthful source values', () => {
    renderWidget();
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getByText('Vehicles')).toBeInTheDocument();
    expect(strip.getByText('4')).toBeInTheDocument();
    expect(strip.getByText('online')).toBeInTheDocument();
    expect(strip.getByText('2')).toBeInTheDocument();
    expect(strip.getByText('2 asleep/offline')).toBeInTheDocument();
    expect(strip.getByText('Distance (30d)')).toBeInTheDocument();
    expect(strip.getByText('1,234')).toBeInTheDocument();
    expect(strip.getByText('km')).toBeInTheDocument();
    expect(strip.getByText('Energy (30d)')).toBeInTheDocument();
    expect(strip.getByText('250.0')).toBeInTheDocument();
    expect(strip.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('uses the shared workspace range and shared display distance unit', () => {
    state.distance = 'mi';
    state.analytics.data = { total_distance_km: 1609.344, total_energy_kwh: 250 };
    renderWidget();
    expect(useFleetAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      start: expect.any(String),
      end: expect.any(String),
    }));
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
  });

  it('keeps partial registry and analytics evidence without fabrication', () => {
    state.vehicles.data = [{ id: 1, state: 'online' }];
    state.analytics.data = undefined;
    renderWidget();
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getByText('Vehicles')).toBeInTheDocument();
    expect(strip.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(strip.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders an honest empty state when both sources have no readings', () => {
    state.vehicles.data = [];
    state.analytics.data = undefined;
    renderWidget();
    expect(screen.getByText('No fleet data available')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-stats-bar')).not.toBeInTheDocument();
  });

  it('preserves measured zeros and keeps refresh wired', () => {
    state.vehicles.data = [];
    state.analytics.data = { total_distance_km: 0, total_energy_kwh: 0 };
    renderWidget();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });
});

describe('toDistanceDisplay', () => {
  it('converts derived-SI kilometres through metres', () => {
    expect(toDistanceDisplay(1234, 'km')).toBe(1234);
    expect(toDistanceDisplay(1609.344, 'mi')).toBeCloseTo(1000, 6);
    expect(toDistanceDisplay(Number.NaN, 'km')).toBe(0);
  });
});
