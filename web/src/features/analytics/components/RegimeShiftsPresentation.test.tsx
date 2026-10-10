import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Drive } from '@/types/driving';
import type { StatMetric } from '@/components/data-display';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { UnitPref } from '@/lib/unitConversion';
import RegimeShiftsPage from '../pages/RegimeShiftsPage';

const state = vi.hoisted(() => {
  const source: { data: Drive[] | undefined; error: Error | null; loading: boolean } = {
    data: undefined, error: null, loading: false,
  };
  const metrics: { current: readonly StatMetric[] } = { current: [] };
  return { ...source, metrics, retry: vi.fn() };
});
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    data: state.data, error: state.error, isError: !!state.error,
    isLoading: state.loading, refetch: state.retry,
  }),
}));
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    useOperationalMetrics: (metrics: readonly StatMetric[], preferences?: MetricPreferences) => {
      state.metrics.current = metrics;
      return actual.useOperationalMetrics(metrics, preferences);
    },
  };
});
vi.mock('@/hooks/useUnits', async () => {
  const { formatTemperature } = await import('@/lib/unitConversion');
  const unitPrefs: UnitPref = {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 1, locale: 'en-US',
  };
  return {
    useUnits: () => ({
      formatTemperature: (value: number) => formatTemperature(value, unitPrefs),
      unitPrefs,
    }),
  };
});
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <RegimeShiftsPage />
  </MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.data = undefined; state.error = null; state.loading = false; state.metrics.current = [];
  vi.clearAllMocks();
});

function weeklyDrives(): Drive[] {
  return Array.from({ length: 12 }, (_, index) => {
    const startTs = new Date(Date.UTC(2024, 0, 1 + index * 7, 12)).toISOString();
    return {
      id: index + 1, vehicleId: 7, startTs, endTs: startTs, durationS: 3600,
      distanceM: 10000, energyUsedWh: index < 6 ? 1500 : 3000,
      outsideTempAvgC: 10, insideTempAvgC: null, regenEnergyWh: null,
      startAddress: null, endAddress: null, startLat: null, startLon: null,
      endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
      avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null, score: null,
      endedStatus: null, createdAt: startTs, updatedAt: startTs,
    };
  });
}

describe('regime source frames preserve unknown versus returned-empty evidence', () => {
  it('a fatal source failure never reports zero analyzed weeks or a measured absence of shifts', () => {
    state.error = new Error('history unavailable');
    const { container } = show();
    expect(screen.getByRole('heading', { name: 'Weekly consumption & detected regimes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift log' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(state.metrics.current.map(metric => metric.rawValue)).toEqual([null, null, null, null]);
    expect(screen.queryByText('over 0 weeks')).not.toBeInTheDocument();
    expect(screen.queryByText('none detected')).not.toBeInTheDocument();
  });
  it('returned-empty source evidence survives a failed refresh and keeps its original no-shift interpretation', () => {
    state.data = [];
    state.error = new Error('refresh failed');
    const { container } = show();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('over 0 weeks')).toBeInTheDocument();
    expect(screen.getByText('none detected')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(state.metrics.current.map(metric => metric.rawValue)).toEqual([0, null, null, undefined]);
    expect(container.querySelector('[data-operational-metric="regimes-count"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(3);
    expect(screen.getByText('Returned drive-history window')).toBeInTheDocument();
    expect(screen.getByText('Continuous observation coverage is unknown.')).toBeInTheDocument();
  });

  it('keeps metric labels and source frames busy without displaying fabricated loading values', () => {
    state.loading = true;
    const { container } = show();
    expect(screen.getByTestId('regime-summary')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.getByText('Loading drive history')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weekly consumption & detected regimes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift log' })).toBeInTheDocument();
  });

  it('retains raw Wh/m, percentage and measured zero Celsius delta from real drive evidence', () => {
    state.data = weeklyDrives();
    const { container } = show();
    expect(state.metrics.current.map(metric => metric.rawValue)).toEqual([2, 0.3, 100, 0]);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="regimes-current"] [data-operational-value]')).toHaveTextContent('300 Wh/km');
    expect(container.querySelector('[data-operational-metric="regimes-last-shift"] [data-operational-value]')).toHaveTextContent('+100%');
    expect(container.querySelector('[data-operational-metric="regimes-temperature"] [data-operational-value]')).toHaveTextContent('0.0°C');
    expect(screen.getByText('over 12 weeks')).toBeInTheDocument();
  });

  it('opens the real review drawer with retained no-shift context and closes it without dropping source frames', () => {
    state.data = [];
    state.error = new Error('refresh failed');
    show();
    fireEvent.click(within(screen.getByTestId('regime-summary')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Regime summary metrics details' });
    expect(within(drawer).getByText('Retained drive history')).toBeInTheDocument();
    expect(within(drawer).getByText('Drive history')).toBeInTheDocument();
    expect(within(drawer).getByText('over 0 weeks')).toBeInTheDocument();
    expect(within(drawer).getByText('none detected')).toBeInTheDocument();
    expect(within(drawer).getByText('avg temp change at last shift')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shift log' })).toBeInTheDocument();
  });
});
