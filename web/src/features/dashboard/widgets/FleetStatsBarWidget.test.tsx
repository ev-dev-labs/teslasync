import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    ] as Array<{ id: number; state: string }> | null | undefined,
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
    } as Partial<{ total_distance_km: number | null; total_energy_kwh: number | null }> | undefined,
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
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

async function renderWidget(packId: PackId, cols = 4, timeRange?: string) {
  const result = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <PackBoundary requestedPackId={packId}>
        <FleetStatsBarWidget size={{ cols, rows: 2 }} config={timeRange ? { timeRange } : undefined} />
      </PackBoundary>
    </MemoryRouter>,
  );
  expect(result.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic' && screen.queryByTestId('fleet-stats-bar')) {
    await waitFor(() => {
      expect(result.container.querySelector('[data-status-appearance]'))
        .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
    });
  }
  return result;
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
  state.vehicles.refetch.mockClear();
  state.analytics.refetch.mockClear();
});

afterEach(cleanup);

describe.each(PACK_IDS)('FleetStatsBarWidget — %s', (packId) => {
  it('applies the widget range only to historical analytics, not live vehicle counts', async () => {
    await renderWidget(packId, 4, '7d');
    expect(useFleetAnalytics).toHaveBeenCalledWith(expect.objectContaining({ widgetRange: '7d' }));
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getByText('Vehicles')).toBeInTheDocument();
    expect(strip.getByText('4')).toBeInTheDocument();
    expect(strip.getByText('Distance (selected range)')).toBeInTheDocument();
    expect(strip.getByText('Energy (selected range)')).toBeInTheDocument();
  });

  it.each([1, 4])('preserves all four KPIs and source values at width %i', async (cols) => {
    await renderWidget(packId, cols);
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getByText('Vehicles')).toBeInTheDocument();
    expect(strip.getByText('4')).toBeInTheDocument();
    expect(strip.getByText('online')).toBeInTheDocument();
    expect(strip.getByText('2')).toBeInTheDocument();
    expect(strip.getByText('2 asleep/offline')).toBeInTheDocument();
    expect(strip.getByText('Distance (view range)')).toBeInTheDocument();
    expect(strip.getByText('1,234')).toBeInTheDocument();
    expect(strip.getByText('km')).toBeInTheDocument();
    expect(strip.getByText('Energy (view range)')).toBeInTheDocument();
    expect(strip.getByText('250.0')).toBeInTheDocument();
    expect(strip.getByText('kWh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('uses the shared workspace range and shared display distance unit', async () => {
    state.distance = 'mi';
    state.analytics.data = { total_distance_km: 1609.344, total_energy_kwh: 250 };
    await renderWidget(packId);
    expect(useFleetAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      start: expect.any(String),
      end: expect.any(String),
    }));
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
  });

  it('keeps partial registry and analytics evidence without fabrication', async () => {
    state.vehicles.data = [{ id: 1, state: 'online' }];
    state.analytics.data = undefined;
    const { container } = await renderWidget(packId);
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(strip.getByText('Vehicles')).toBeInTheDocument();
    expect(strip.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(strip.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders an honest empty state when both sources have no readings', async () => {
    state.vehicles.data = [];
    state.analytics.data = undefined;
    await renderWidget(packId);
    expect(screen.getByText('No fleet data available')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-stats-bar')).not.toBeInTheDocument();
  });

  it('preserves measured zeros and refreshes both sources', async () => {
    state.vehicles.data = [];
    state.analytics.data = { total_distance_km: 0, total_energy_kwh: 0 };
    await renderWidget(packId);
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getAllByText('0')).toHaveLength(3);
    expect(strip.getByText('0.0')).toBeInTheDocument();
    expect(strip.getByText('km')).toBeInTheDocument();
    expect(strip.getByText('kWh')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.analytics.refetch).toHaveBeenCalledOnce();
  });

  it('does not turn a missing registry or an unknown vehicle state into an offline count', async () => {
    state.vehicles.data = null;
    const result = await renderWidget(packId);
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getAllByText('—')).toHaveLength(2);
    expect(strip.getByText('1,234')).toBeInTheDocument();
    expect(strip.getByText('250.0')).toBeInTheDocument();
    expect(strip.queryByText(/asleep\/offline/)).not.toBeInTheDocument();
    result.unmount();

    state.vehicles.data = [{ id: 1, state: 'unknown' }, { id: 2, state: 'online' }];
    await renderWidget(packId);
    const knownStrip = within(screen.getByTestId('fleet-stats-bar'));
    expect(knownStrip.getByText('2')).toBeInTheDocument();
    expect(knownStrip.getByText('1')).toBeInTheDocument();
    expect(knownStrip.queryByText(/asleep\/offline/)).not.toBeInTheDocument();
  });

  it.each([
    { name: 'missing', data: {} },
    { name: 'null', data: { total_distance_km: null, total_energy_kwh: null } },
    { name: 'non-finite', data: { total_distance_km: Number.NaN, total_energy_kwh: Number.POSITIVE_INFINITY } },
  ])('keeps $name analytics unknown rather than showing measured zero', async ({ data }) => {
    state.analytics.data = data;
    await renderWidget(packId);
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getAllByText('—')).toHaveLength(2);
    expect(strip.getByText('4')).toBeInTheDocument();
    expect(strip.queryByText(/NaN|Infinity|^0(?:\.0)?$/)).not.toBeInTheDocument();
    expect(strip.queryByText('km')).not.toBeInTheDocument();
    expect(strip.queryByText('kWh')).not.toBeInTheDocument();
  });

  it('shows initial loading without fabricating totals or an empty result', async () => {
    state.vehicles.data = undefined;
    state.analytics.data = undefined;
    for (const query of [state.vehicles, state.analytics]) {
      Object.assign(query, { isLoading: true, isPending: true, isFetching: true, dataUpdatedAt: 0 });
    }
    const { container } = await renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('fleet-stats-bar')).not.toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('exposes an initial failure and retries both sources without showing totals', async () => {
    state.vehicles.data = undefined;
    state.analytics.data = undefined;
    for (const query of [state.vehicles, state.analytics]) {
      Object.assign(query, { isError: true, error: new Error('Request failed'), dataUpdatedAt: 0 });
    }
    const { container } = await renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByTestId('fleet-stats-bar')).not.toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.analytics.refetch).toHaveBeenCalledOnce();
  });

  it('retains all totals and discloses a failed background refresh', async () => {
    state.analytics.isError = true;
    state.analytics.error = new Error('Refresh failed');
    const { container } = await renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('widget-body')).toHaveAttribute('data-content-degraded', 'true');
    const strip = within(screen.getByTestId('fleet-stats-bar'));
    expect(strip.getByText('4')).toBeInTheDocument();
    expect(strip.getByText('2 asleep/offline')).toBeInTheDocument();
    expect(strip.getByText('1,234')).toBeInTheDocument();
    expect(strip.getByText('250.0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh.*error/i }));
    expect(state.vehicles.refetch).toHaveBeenCalledOnce();
    expect(state.analytics.refetch).toHaveBeenCalledOnce();
  });

  it('retains totals during an in-flight refresh and prevents duplicate refreshes', async () => {
    state.vehicles.isFetching = true;
    state.analytics.isFetching = true;
    const { container } = await renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('fleet-stats-bar')).toHaveTextContent('1,234');
    expect(screen.getByTestId('fleet-stats-bar')).toHaveTextContent('250.0');
    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refresh).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(refresh);
    expect(state.vehicles.refetch).not.toHaveBeenCalled();
    expect(state.analytics.refetch).not.toHaveBeenCalled();
  });
});

describe('toDistanceDisplay', () => {
  it('converts derived-SI kilometres through metres', () => {
    expect(toDistanceDisplay(1234, 'km')).toBe(1234);
    expect(toDistanceDisplay(1609.344, 'mi')).toBeCloseTo(1000, 6);
    expect(toDistanceDisplay(Number.NaN, 'km')).toBe(0);
  });
});
