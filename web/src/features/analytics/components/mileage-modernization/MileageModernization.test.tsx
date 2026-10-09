import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { MileageStats, DailyMileageBucket, MonthlyMileageBucket } from '@/types/analytics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      let text = typeof fallback === 'string' ? fallback : key;
      for (const [name, value] of Object.entries(options ?? {})) {
        text = text.replace(`{{${name}}}`, String(value));
      }
      return text;
    },
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useMileageStats: vi.fn(), useDailyMileage: vi.fn(), useMonthlyMileage: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--accent)', 'var(--success)', 'var(--warning)'],
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

import { useMileageStats, useDailyMileage, useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import MileagePage from '../../pages/MileagePage';

const stats: MileageStats = {
  vehicle_id: 7, lifetime_km: 12000, last_7d_km: 210, last_30d_km: 930,
  last_365d_km: 9500, drive_count_lifetime: 500, drive_count_30d: 40,
  first_drive_at: null, last_drive_at: null,
};
const days: DailyMileageBucket[] = [
  { date: '2024-06-01', drive_count: 2, total_km: 40, end_odometer_km: 12000 },
  { date: '2024-06-02', drive_count: 1, total_km: 20, end_odometer_km: null },
];
const months: MonthlyMileageBucket[] = [
  { year_month: '2024-05', drive_count: 20, total_km: 400, total_wh_consumed: null, avg_efficiency_wh_per_km: null },
  { year_month: '2024-06', drive_count: 0, total_km: 0, total_wh_consumed: null, avg_efficiency_wh_per_km: null },
];
function query<T>(data: T | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data, error: null, isLoading: false, isFetching: false, isError: false,
    isStale: false, dataUpdatedAt: 1700000000000, refetch: vi.fn(), ...overrides,
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter><QueryClientProvider client={client}><MileagePage /></QueryClientProvider></MemoryRouter>,
  );
}
function panel(title: string) {
  const element = screen.getByRole('heading', { name: title, level: 3 }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing persistent card: ${title}`);
  return within(element);
}
function tile(label: string) {
  const element = within(screen.getByRole('region', { name: 'Mileage summary metrics' }))
    .getByText(label).closest('[data-operational-metric]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing metric: ${label}`);
  return element;
}

function metricValue(label: string) {
  const element = tile(label).querySelector('[data-operational-value]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing metric value: ${label}`);
  return element.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.mocked(useSelectedVehicle).mockReturnValue({ vehicleId: 7 } as ReturnType<typeof useSelectedVehicle>);
  vi.mocked(useUnits).mockReturnValue({ unitPrefs: { distance: 'km' } } as ReturnType<typeof useUnits>);
  vi.mocked(useMileageStats).mockReturnValue(query(stats) as ReturnType<typeof useMileageStats>);
  vi.mocked(useDailyMileage).mockReturnValue(query(days) as ReturnType<typeof useDailyMileage>);
  vi.mocked(useMonthlyMileage).mockReturnValue(query(months) as ReturnType<typeof useMonthlyMileage>);
});

describe('live mileage modernization preservation', () => {
  it('uses one shared card canvas with all six content shells and unchanged hook scopes', async () => {
    const { container } = mount();
    expect(container.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(6);
    expect(useMileageStats).toHaveBeenCalledWith('7');
    expect(useDailyMileage).toHaveBeenCalledWith('7', 90);
    expect(useMonthlyMileage).toHaveBeenCalledWith('7');
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
    expect(screen.getByText(/do not accept workspace date bounds/)).toBeInTheDocument();
    // The shared card repeats its description in a collapsed help tooltip.
    const monthlyProvenance = panel('Monthly distance').getByText(/server’s default 24-month window/, {
      selector: '[data-card-desc="true"]',
    });
    expect(monthlyProvenance).toBeInTheDocument();
    const descriptionDisclosures: HTMLDetailsElement[] = [];
    for (let disclosure = monthlyProvenance.closest('details'); disclosure;
      disclosure = disclosure.parentElement?.closest('details') ?? null) {
      descriptionDisclosures.push(disclosure);
    }
    for (const disclosure of descriptionDisclosures.reverse()) {
      if (disclosure.open) continue;
      const trigger = disclosure.querySelector(':scope > summary');
      if (!trigger) throw new Error('Monthly provenance disclosure is missing its own summary control');
      fireEvent.click(trigger);
      expect(disclosure.open).toBe(true);
    }
    fireEvent.click(panel('Monthly distance').getByRole('button', {
      name: 'Read full description for Monthly distance',
    }));
    await waitFor(() => {
      expect(panel('Monthly distance').getByText(/server’s default 24-month window/, {
        selector: '[data-card-desc="true"]',
      })).toBeVisible();
    });
  });

  it('keeps six KPI meanings, exact operands, units and occurrence-specific precision', () => {
    mount();
    expect(metricValue('Total distance')).toBe('12,000 km');
    expect(metricValue('Total drives')).toBe('500');
    expect(metricValue('Daily avg (30d)')).toBe('31.00 km');
    expect(metricValue('Annual projection')).toBe('11,315 km');
    expect(metricValue('Last 7 days')).toBe('210.00 km');
    expect(metricValue('Last 365 days')).toBe('9,500 km');
    expect(screen.getByText(/Recording completeness is not reported/)).toBeInTheDocument();
  });

  it('converts exactly once using the current distance preference and preserves reactive numeric locale', () => {
    vi.mocked(useUnits).mockReturnValue({ unitPrefs: { distance: 'mi' } } as ReturnType<typeof useUnits>);
    mount();
    expect(metricValue('Total distance')).toBe(
      `${fmtNumber(convertDistanceFromSI(12000 * 1000, 'mi'), 0)} mi`);
    expect(within(screen.getByRole('table')).getByText('Distance (mi)')).toBeInTheDocument();
    act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(3); });
    expect(metricValue('Daily avg (30d)')).toBe(
      `${fmtNumber(convertDistanceFromSI((930 / 30) * 1000, 'mi'), 3, 'de-DE')} mi`);
  });

  it.each(['summary', 'daily', 'monthly'] as const)('retains %s data and unrelated neighbors after refresh failure', (source) => {
    const failed = { error: new ApiError('refresh failed', 503), isError: true };
    const retry = vi.fn();
    if (source === 'summary') vi.mocked(useMileageStats).mockReturnValue(query(stats, { ...failed, refetch: retry }) as ReturnType<typeof useMileageStats>);
    if (source === 'daily') vi.mocked(useDailyMileage).mockReturnValue(query(days, { ...failed, refetch: retry }) as ReturnType<typeof useDailyMileage>);
    if (source === 'monthly') vi.mocked(useMonthlyMileage).mockReturnValue(query(months, { ...failed, refetch: retry }) as ReturnType<typeof useMonthlyMileage>);
    mount();
    expect(tile('Total distance')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByRole('img', { name: 'Odometer readings over time' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Monthly distance traveled over time' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('2024-05')).toBeInTheDocument();
    expect(screen.getAllByText('Refresh failed. Showing the last successful mileage data.')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('replaces only a source with fatal no-data failure, and keeps all panel shells', () => {
    vi.mocked(useDailyMileage).mockReturnValue(query(undefined, {
      error: new ApiError('daily unavailable', 503), isError: true,
    }) as ReturnType<typeof useDailyMileage>);
    const { container } = mount();
    expect(container.querySelectorAll('[data-card]')).toHaveLength(6);
    expect(screen.queryByRole('img', { name: 'Odometer readings over time' })).toBeNull();
    expect(panel('Odometer over time').getByText('Service unavailable')).toBeInTheDocument();
    expect(tile('Total distance')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByRole('img', { name: 'Monthly distance traveled over time' })).toBeInTheDocument();
  });

  it('does not manufacture zero KPIs from a missing summary, but preserves measured zeros', async () => {
    const retry = vi.fn();
    vi.mocked(useMileageStats).mockReturnValue(query(undefined, { refetch: retry }) as ReturnType<typeof useMileageStats>);
    const view = mount();
    expect(within(panel('Mileage summary metrics').getByRole('status'))
      .getByText('Mileage summary has not been supplied.')).toBeInTheDocument();
    expect(within(panel('Distance by window').getByRole('status'))
      .getByText('Mileage summary has not been supplied.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Mileage summary metrics' }))
      .getAllByRole('listitem')).toHaveLength(6);
    for (const label of ['Total distance', 'Total drives', 'Daily avg (30d)',
      'Annual projection', 'Last 7 days', 'Last 365 days']) {
      expect(tile(label)).toHaveAttribute('data-value-state', 'missing');
      expect(metricValue(label)).toBe('—');
      await waitFor(() => {
        expect(within(tile(label)).getByText(label)).toBeVisible();
      });
    }
    expect(within(panel('Mileage summary metrics').getByRole('status'))
      .getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
    await waitFor(() => {
      expect(within(panel('Distance by window').getByRole('status'))
      .getByRole('button', { name: 'Refresh' })).toBeVisible();
    });
    expect(panel('Mileage summary metrics').getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
    fireEvent.click(panel('Distance by window').getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    view.unmount();
    vi.mocked(useMileageStats).mockReturnValue(query({ ...stats, lifetime_km: 0, last_30d_km: 0 }) as ReturnType<typeof useMileageStats>);
    mount();
    expect(metricValue('Total distance')).toBe('0 km');
    expect(metricValue('Daily avg (30d)')).toBe('0.00 km');
  });

  it('keeps retained content during paused refresh instead of reporting empty or failure', () => {
    vi.mocked(useMonthlyMileage).mockReturnValue(query(months, {
      fetchStatus: 'paused',
    }) as ReturnType<typeof useMonthlyMileage>);
    mount();
    expect(screen.getAllByText('Refresh is paused. Showing the last successful mileage data.')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Monthly distance traveled over time' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('2024-05')).toBeInTheDocument();
  });

  it('keeps initial loading distinct from empty daily/monthly sources', () => {
    vi.mocked(useDailyMileage).mockReturnValue(query(undefined, { isLoading: true }) as ReturnType<typeof useDailyMileage>);
    vi.mocked(useMonthlyMileage).mockReturnValue(query([]) as ReturnType<typeof useMonthlyMileage>);
    mount();
    expect(panel('Odometer over time').queryByText('No odometer readings yet')).toBeNull();
    expect(panel('Daily distance').queryByText('No daily distance yet')).toBeNull();
    expect(panel('Monthly distance').getByText('No monthly distance yet')).toBeInTheDocument();
    expect(tile('Total distance')).toHaveAttribute('data-value-state', 'value');
  });

  it('filters only missing absolute odometers, not corresponding daily drive distance', () => {
    vi.mocked(useDailyMileage).mockReturnValue(query(days.map(day => ({ ...day, end_odometer_km: null }))) as ReturnType<typeof useDailyMileage>);
    mount();
    expect(panel('Odometer over time').getByText('No odometer readings yet')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Daily distance traveled over time' })).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Distance / drive (km)')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('20.00')).toBeInTheDocument();
  });

  it('keeps the vehicle-selection guard before data scaffolding', () => {
    vi.mocked(useSelectedVehicle).mockReturnValue({ vehicleId: null } as ReturnType<typeof useSelectedVehicle>);
    const { container } = mount();
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up TeslaSync' })).toBeInTheDocument();
    expect(container.querySelector('[data-card-grid]')).toBeNull();
  });
});
