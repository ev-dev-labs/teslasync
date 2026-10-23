import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  vehicles: {
    data: [
      { id: 1, state: 'online' },
      { id: 2, state: 'offline' },
      { id: 3, state: 'online' },
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
      total_distance_km: 1000,
      total_energy_kwh: 250,
      avg_efficiency_wh_km: 160,
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
        String((typeof options?.[name] === 'undefined' ? options?.[name] : options?.[name]) ?? `{{${name}}}`));
    },
  }),
}));

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: () => state.vehicles };
});
vi.mock('@/api/hooks/useAnalytics', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAnalytics')>();
  return { ...actual, useFleetAnalytics: () => state.analytics };
});
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: state.distance } }),
}));

import FleetStatsWidget from './FleetStatsWidget';

function renderWidget() {
  return render(
    <MemoryRouter>
      <FleetStatsWidget size={{ cols: 4, rows: 2 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.distance = 'km';
  state.vehicles.data = [
    { id: 1, state: 'online' },
    { id: 2, state: 'offline' },
    { id: 3, state: 'online' },
  ];
  state.vehicles.isLoading = false;
  state.vehicles.isPending = false;
  state.vehicles.isError = false;
  state.vehicles.isFetching = false;
  state.vehicles.isStale = false;
  state.vehicles.error = null;
  state.vehicles.refetch.mockClear();
  state.analytics.data = {
    total_distance_km: 1000,
    total_energy_kwh: 250,
    avg_efficiency_wh_km: 160,
  };
  state.analytics.isLoading = false;
  state.analytics.isPending = false;
  state.analytics.isError = false;
  state.analytics.isFetching = false;
  state.analytics.isStale = false;
  state.analytics.error = null;
  state.analytics.refetch.mockClear();
});

afterEach(cleanup);

describe('FleetStatsWidget — After card', () => {
  it('renders one concise 2-column stats grid with the shared shell freshness dot', () => {
    const { container } = renderWidget();
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('Fleet size')).toBeInTheDocument();
    expect(stats.getByText('3')).toBeInTheDocument();
    expect(stats.getByText('Distance (30d)')).toBeInTheDocument();
    expect(stats.getByText('1,000')).toBeInTheDocument();
    expect(stats.getByText('km')).toBeInTheDocument();
    expect(stats.getByText('Energy (30d)')).toBeInTheDocument();
    expect(stats.getByText('250.0')).toBeInTheDocument();
    expect(stats.getByText('kWh')).toBeInTheDocument();
    expect(stats.getByText('Efficiency')).toBeInTheDocument();
    expect(stats.getByText('160.0')).toBeInTheDocument();
    expect(stats.getByText('Wh/km')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
    expect(screen.queryByText('Alerts')).not.toBeInTheDocument();
  });

  it('uses real SI conversion for imperial distance and efficiency', () => {
    state.distance = 'mi';
    state.analytics.data = {
      total_distance_km: 1609.344,
      total_energy_kwh: 250,
      avg_efficiency_wh_km: 200,
    };
    renderWidget();
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('1,000')).toBeInTheDocument();
    expect(stats.getByText('mi')).toBeInTheDocument();
    expect(stats.getByText('321.9')).toBeInTheDocument();
    expect(stats.getByText('Wh/mi')).toBeInTheDocument();
  });

  it('preserves measured zeros instead of replacing them with missing placeholders', () => {
    state.vehicles.data = [];
    state.analytics.data = {
      total_distance_km: 0,
      total_energy_kwh: 0,
      avg_efficiency_wh_km: 0,
    };
    renderWidget();
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(stats.getAllByText('0.0').length).toBe(2);
    expect(stats.queryByText('—')).not.toBeInTheDocument();
  });

  it('does not fabricate values for missing analytics', () => {
    state.analytics.data = undefined;
    renderWidget();
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('3')).toBeInTheDocument();
    expect(stats.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('keeps loading and error states truthful', () => {
    state.vehicles.data = undefined;
    state.analytics.data = undefined;
    state.analytics.isLoading = true;
    const loading = renderWidget();
    expect(loading.getByRole('heading', { name: 'Fleet stats' })).toBeInTheDocument();
    loading.unmount();

    state.analytics.isLoading = false;
    state.analytics.isError = true;
    state.analytics.error = new Error('fleet analytics unavailable');
    renderWidget();
    expect(screen.queryByText('250')).not.toBeInTheDocument();
  });

  it('keeps the shared freshness control wired to refresh', () => {
    const refetchVehicles = vi.fn();
    const refetchAnalytics = vi.fn();
    state.vehicles.refetch = refetchVehicles;
    state.analytics.refetch = refetchAnalytics;
    renderWidget();
    const refresh = screen.getByRole('button', { name: /refresh/i });
    refresh.click();
    expect(refetchVehicles).toHaveBeenCalledOnce();
    expect(refetchAnalytics).toHaveBeenCalledOnce();
  });
});
