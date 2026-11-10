import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetProps } from './types';

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
  return { ...actual, useFleetAnalytics: vi.fn(() => state.analytics) };
});
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: state.distance } }),
}));

import FleetStatsWidget from './FleetStatsWidget';

async function renderWidget(packId: PackId, props: Partial<WidgetProps> = {}) {
  const result = render(
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <FleetStatsWidget size={{ cols: 4, rows: 2 }} {...props} />
      </PackBoundary>
    </MemoryRouter>,
  );
  expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic' && result.queryByTestId('fleet-stats')) {
    await waitFor(() => expect(result.container.querySelector('[data-status-appearance]'))
      .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]));
  }
  return result;
}

beforeEach(() => {
  vi.mocked(useFleetAnalytics).mockClear();
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
  state.vehicles.dataUpdatedAt = Date.now();
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
  state.analytics.dataUpdatedAt = Date.now();
  state.analytics.refetch.mockClear();
});

afterEach(cleanup);

describe.each(PACK_IDS)('FleetStatsWidget — %s', (packId) => {
  it('preserves all four statistics and units with the shared shell freshness dot', async () => {
    await renderWidget(packId);
    expect(useFleetAnalytics).toHaveBeenLastCalledWith(30);
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

  it('uses real SI conversion for imperial distance and efficiency', async () => {
    state.distance = 'mi';
    state.analytics.data = {
      total_distance_km: 1609.344,
      total_energy_kwh: 250,
      avg_efficiency_wh_km: 200,
    };
    await renderWidget(packId);
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('1,000')).toBeInTheDocument();
    expect(stats.getByText('mi')).toBeInTheDocument();
    expect(stats.getByText('321.9')).toBeInTheDocument();
    expect(stats.getByText('Wh/mi')).toBeInTheDocument();
  });

  it('preserves measured zeros instead of replacing them with missing placeholders', async () => {
    state.vehicles.data = [];
    state.analytics.data = {
      total_distance_km: 0,
      total_energy_kwh: 0,
      avg_efficiency_wh_km: 0,
    };
    await renderWidget(packId);
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(stats.getAllByText('0.0').length).toBe(2);
    expect(stats.queryByText('—')).not.toBeInTheDocument();
  });

  it.each(['empty', 'loading', 'failed'] as const)('does not fabricate values for %s analytics', async (status) => {
    state.analytics.data = undefined;
    state.analytics.isLoading = status === 'loading';
    state.analytics.isPending = status === 'loading';
    state.analytics.isError = status === 'failed';
    state.analytics.error = status === 'failed' ? new Error('fleet analytics unavailable') : null;
    const result = await renderWidget(packId);
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('3')).toBeInTheDocument();
    expect(stats.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    if (status !== 'empty') {
      expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    }
  });

  it('keeps loading and initial error states truthful without showing fabricated totals', async () => {
    state.vehicles.data = undefined;
    state.analytics.data = undefined;
    state.vehicles.isLoading = true;
    state.vehicles.isPending = true;
    state.analytics.isLoading = true;
    state.analytics.isPending = true;
    const loading = await renderWidget(packId);
    expect(loading.getByRole('heading', { name: 'Fleet stats' })).toBeInTheDocument();
    expect(loading.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initial');
    expect(loading.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('fleet-stats')).not.toBeInTheDocument();
    loading.unmount();

    state.vehicles.isLoading = false;
    state.vehicles.isPending = false;
    state.vehicles.isError = true;
    state.vehicles.error = new Error('fleet vehicles unavailable');
    state.analytics.isLoading = false;
    state.analytics.isPending = false;
    state.analytics.isError = true;
    state.analytics.error = new Error('fleet analytics unavailable');
    const failed = await renderWidget(packId);
    expect(failed.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByTestId('fleet-stats')).not.toBeInTheDocument();
  });

  it('keeps the shared freshness control wired to both sources', async () => {
    const refetchVehicles = vi.fn();
    const refetchAnalytics = vi.fn();
    state.vehicles.refetch = refetchVehicles;
    state.analytics.refetch = refetchAnalytics;
    await renderWidget(packId);
    const refresh = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refresh);
    expect(refetchVehicles).toHaveBeenCalledOnce();
    expect(refetchAnalytics).toHaveBeenCalledOnce();
  });

  it('keeps unknown and non-finite readings distinct from measured zero', async () => {
    state.vehicles.data = undefined;
    state.analytics.data = {
      total_distance_km: Number.NaN,
      total_energy_kwh: Number.POSITIVE_INFINITY,
      avg_efficiency_wh_km: Number.NEGATIVE_INFINITY,
    };
    await renderWidget(packId);
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getAllByText('—')).toHaveLength(4);
    expect(stats.queryByText(/NaN|Infinity|^0(?:\.0)?$/)).not.toBeInTheDocument();
    expect(stats.getByText('Fleet size')).toBeInTheDocument();
    expect(stats.getByText('Distance (30d)')).toBeInTheDocument();
    expect(stats.getByText('Energy (30d)')).toBeInTheDocument();
    expect(stats.getByText('Efficiency')).toBeInTheDocument();
    expect(stats.queryByText(/^(?:km|kWh|Wh\/km)$/)).not.toBeInTheDocument();
  });

  it('keeps retained totals and their warning visible after a failed background refresh', async () => {
    state.analytics.isError = true;
    state.analytics.error = new Error('fleet analytics refresh failed');
    const result = await renderWidget(packId);
    expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('3')).toBeInTheDocument();
    expect(stats.getByText('1,000')).toBeInTheDocument();
    expect(stats.getByText('250.0')).toBeInTheDocument();
    expect(stats.getByText('160.0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.analytics.refetch).toHaveBeenCalledOnce();
  });

  it('preserves selected-range controller scope and all totals in a compact widget', async () => {
    await renderWidget(packId, { config: { timeRange: '7d' }, size: { cols: 1, rows: 2 } });
    expect(useFleetAnalytics).toHaveBeenLastCalledWith({ widgetRange: '7d' });
    const stats = within(screen.getByTestId('fleet-stats'));
    expect(stats.getByText('Fleet size')).toBeInTheDocument();
    expect(stats.getByText('Distance (selected range)')).toBeInTheDocument();
    expect(stats.getByText('Energy (selected range)')).toBeInTheDocument();
    expect(stats.getByText('Efficiency')).toBeInTheDocument();
    expect(stats.getByText('3')).toBeInTheDocument();
    expect(stats.getByText('1,000')).toBeInTheDocument();
    expect(stats.getByText('250.0')).toBeInTheDocument();
    expect(stats.getByText('160.0')).toBeInTheDocument();
  });
});
