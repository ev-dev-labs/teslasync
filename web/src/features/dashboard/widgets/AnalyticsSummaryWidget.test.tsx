import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetAnalytics } from '@/api/types';

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
  query: {
    data: {
      total_distance_km: 1000,
      total_energy_kwh: 200,
      avg_efficiency_wh_km: 150,
      total_cost: 250,
      vehicle_comparison: [],
    } as Partial<FleetAnalytics> | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null as Error | null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  },
  distance: 'km' as 'km' | 'mi',
  analyticsOptions: vi.fn<(options: { start?: string; end?: string; widgetRange?: string }) => void>(),
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

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFleetAnalytics: (options: { start?: string; end?: string; widgetRange?: string }) => {
    state.analyticsOptions(options);
    return state.query;
  },
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: state.distance } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

import AnalyticsSummaryWidget, { toAnalyticsDistanceDisplay } from './AnalyticsSummaryWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetConfig } from './types';

async function renderWidget(packId: PackId, cols = 2, config?: WidgetConfig) {
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <PackBoundary requestedPackId={packId}>
        <AnalyticsSummaryWidget size={{ cols, rows: 2 }} config={config} />
      </PackBoundary>
    </MemoryRouter>,
  );
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic' && state.query.data != null) {
    await waitFor(() => {
      expect(view.container.querySelector('[data-status-appearance]'))
        .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]);
    });
  }
  return view;
}

beforeEach(() => {
  state.distance = 'km';
  state.query.data = {
    total_distance_km: 1000,
    total_energy_kwh: 200,
    avg_efficiency_wh_km: 150,
    total_cost: 250,
    vehicle_comparison: [],
  };
  Object.assign(state.query, {
    isLoading: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null,
    dataUpdatedAt: Date.now(),
  });
  state.query.refetch.mockClear();
  state.analyticsOptions.mockClear();
});

afterEach(cleanup);

describe.each(PACK_IDS)('AnalyticsSummaryWidget — %s', (packId) => {
  it('renders all analytics content through the selected shared presentation', async () => {
    const { container } = await renderWidget(packId);
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getByText('Distance (view range)')).toBeInTheDocument();
    expect(summary.getByText('1,000')).toBeInTheDocument();
    expect(summary.getByText('km')).toBeInTheDocument();
    expect(summary.getByText('Avg efficiency')).toBeInTheDocument();
    expect(summary.getByText('150.0')).toBeInTheDocument();
    expect(summary.getByText('Wh/km')).toBeInTheDocument();
    expect(summary.getByText('Energy consumed')).toBeInTheDocument();
    expect(summary.getByText('200.0')).toBeInTheDocument();
    expect(summary.getByText('kWh')).toBeInTheDocument();
    expect(summary.getByText('Cost / km')).toBeInTheDocument();
    expect(summary.getByText('$0.25')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('uses the shared imperial distance unit for distance, efficiency, and cost', async () => {
    state.distance = 'mi';
    state.query.data = {
      total_distance_km: 1609.344,
      total_energy_kwh: 250,
      avg_efficiency_wh_km: 200,
      total_cost: 321.8688,
      vehicle_comparison: [],
    };
    await renderWidget(packId);
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getByText('1,000')).toBeInTheDocument();
    expect(summary.getByText('mi')).toBeInTheDocument();
    expect(summary.getByText('321.9')).toBeInTheDocument();
    expect(summary.getByText('Wh/mi')).toBeInTheDocument();
    expect(summary.getByText('$0.32')).toBeInTheDocument();
  });

  it('preserves measured zeros instead of inventing missing evidence', async () => {
    state.query.data = {
      total_distance_km: 0,
      total_energy_kwh: 0,
      avg_efficiency_wh_km: 0,
      total_cost: 0,
      vehicle_comparison: [],
    };
    await renderWidget(packId);
    expect(screen.getByTestId('analytics-summary')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0.0').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('analytics-summary')).getByText('—')).toBeInTheDocument();
  });

  it('shows missing measurements as unknown rather than zeros', async () => {
    state.query.data = {
      total_vehicles: 3,
      total_drives: 0,
      total_charging_sessions: 0,
      vehicle_comparison: [],
    };
    await renderWidget(packId);
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getAllByText('—')).toHaveLength(4);
    expect(summary.queryByText('0')).not.toBeInTheDocument();
    expect(summary.queryByText('0.0')).not.toBeInTheDocument();
  });

  it('does not present non-finite readings or divide by an invalid distance', async () => {
    state.query.data = {
      total_distance_km: Number.NaN,
      total_energy_kwh: Number.POSITIVE_INFINITY,
      avg_efficiency_wh_km: Number.NEGATIVE_INFINITY,
      total_cost: 250,
    };
    await renderWidget(packId);
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getAllByText('—')).toHaveLength(4);
    expect(summary.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it('keeps loading and fatal error states truthful and retryable', async () => {
    state.query.data = undefined;
    state.query.isLoading = true;
    const loading = await renderWidget(packId);
    expect(loading.getByRole('heading', { name: 'Analytics summary' })).toBeInTheDocument();
    expect(loading.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('analytics-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/No analytics readings/)).not.toBeInTheDocument();
    loading.unmount();

    state.query.isLoading = false;
    state.query.isError = true;
    state.query.error = new Error('analytics unavailable');
    const failed = await renderWidget(packId);
    expect(failed.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByTestId('analytics-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/No analytics readings/)).not.toBeInTheDocument();
    screen.getByRole('button', { name: /^Refresh/i }).click();
    expect(state.query.refetch).toHaveBeenCalledOnce();
  });

  it('keeps an explicit empty state after a successful response without analytics', async () => {
    state.query.data = undefined;
    await renderWidget(packId);
    expect(screen.getByText('No analytics readings are available yet. They appear after the analytics source returns data.'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('analytics-summary')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Analytics summary' })).toBeInTheDocument();
  });

  it('retains all readings with a source warning after a failed background refresh', async () => {
    state.query.isError = true;
    state.query.isStale = true;
    state.query.error = new Error('analytics refresh unavailable');
    const { container } = await renderWidget(packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    const summary = within(screen.getByTestId('analytics-summary'));
    for (const value of ['1,000', '150.0', '200.0', '$0.25']) {
      expect(summary.getByText(value)).toBeInTheDocument();
    }
    screen.getByRole('button', { name: /^Refresh/i }).click();
    expect(state.query.refetch).toHaveBeenCalledOnce();
  });

  it('preserves the widget-specific range and compact or wide layouts', async () => {
    const compact = await renderWidget(packId, 1, { timeRange: '7d' });
    expect(screen.getByText('Distance (selected range)')).toBeInTheDocument();
    expect(state.analyticsOptions).toHaveBeenLastCalledWith({
      start: expect.any(String),
      end: expect.any(String),
      widgetRange: '7d',
    });
    expect(within(screen.getByTestId('analytics-summary')).getByText('200.0')).toBeInTheDocument();
    compact.unmount();
    await renderWidget(packId, 4);
    expect(screen.getByText('Distance (view range)')).toBeInTheDocument();
    expect(within(screen.getByTestId('analytics-summary')).getByText('$0.25')).toBeInTheDocument();
  });

  it('keeps the shared refresh control wired', async () => {
    await renderWidget(packId);
    screen.getByRole('button', { name: /^Refresh/i }).click();
    expect(state.query.refetch).toHaveBeenCalledOnce();
  });
});

describe('toAnalyticsDistanceDisplay', () => {
  it('converts derived-SI kilometres through metres', () => {
    expect(toAnalyticsDistanceDisplay(1000, 'km')).toBe(1000);
    expect(toAnalyticsDistanceDisplay(1609.344, 'mi')).toBeCloseTo(1000, 6);
  });
});
