import { cleanup, render, screen, within } from '@testing-library/react';
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
    } as FleetAnalytics | undefined,
    isLoading: false,
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

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFleetAnalytics: () => state.query,
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

function renderWidget(cols = 2) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AnalyticsSummaryWidget size={{ cols, rows: 2 }} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.distance = 'km';
  state.query.data = {
    total_distance_km: 1000,
    total_energy_kwh: 200,
    avg_efficiency_wh_km: 150,
    total_cost: 250,
    vehicle_comparison: [],
  } as unknown as FleetAnalytics;
  Object.assign(state.query, {
    isLoading: false,
    isError: false,
    isFetching: false,
    isStale: false,
    error: null,
    dataUpdatedAt: Date.now(),
  });
  state.query.refetch.mockClear();
});

afterEach(cleanup);

describe('AnalyticsSummaryWidget — After card', () => {
  it('renders a concise 2-column analytics summary with shared units and freshness', () => {
    const { container } = renderWidget();
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getByText('Distance (30d)')).toBeInTheDocument();
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

  it('uses the shared imperial distance unit for distance, efficiency, and cost', () => {
    state.distance = 'mi';
    state.query.data = {
      total_distance_km: 1609.344,
      total_energy_kwh: 250,
      avg_efficiency_wh_km: 200,
      total_cost: 321.8688,
      vehicle_comparison: [],
    };
    renderWidget();
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getByText('1,000')).toBeInTheDocument();
    expect(summary.getByText('mi')).toBeInTheDocument();
    expect(summary.getByText('321.9')).toBeInTheDocument();
    expect(summary.getByText('Wh/mi')).toBeInTheDocument();
    expect(summary.getByText('$0.32')).toBeInTheDocument();
  });

  it('preserves measured zeros instead of inventing missing evidence', () => {
    state.query.data = {
      total_distance_km: 0,
      total_energy_kwh: 0,
      avg_efficiency_wh_km: 0,
      total_cost: 0,
      vehicle_comparison: [],
    };
    renderWidget();
    expect(screen.getByTestId('analytics-summary')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0.0').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('shows missing measurements as unknown rather than zeros', () => {
    state.query.data = {
      totalVehicles: 3,
      totalDrives: 0,
      totalChargingSessions: 0,
      vehicle_comparison: [],
    } as unknown as FleetAnalytics;
    renderWidget();
    const summary = within(screen.getByTestId('analytics-summary'));
    expect(summary.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('keeps loading and error states truthful', () => {
    state.query.data = undefined;
    state.query.isLoading = true;
    const loading = renderWidget();
    expect(loading.getByRole('heading', { name: 'Analytics summary' })).toBeInTheDocument();
    loading.unmount();

    state.query.isLoading = false;
    state.query.isError = true;
    state.query.error = new Error('analytics unavailable');
    renderWidget();
    expect(screen.queryByTestId('analytics-summary')).not.toBeInTheDocument();
  });

  it('keeps the shared refresh control wired', () => {
    renderWidget();
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
