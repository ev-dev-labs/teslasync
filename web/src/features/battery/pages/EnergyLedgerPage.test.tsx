import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChartContainerProps } from '@/components/charts/ChartContainer';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: Error | null;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

type ChartCapture = ChartContainerProps;

interface AxisCapture {
  tick?: { fontFamily: string; fontSize: number };
  unit?: string;
}

const H = vi.hoisted(() => ({
  sessions: {
    current: null as unknown as FakeQuery<unknown[]>,
  },
  drives: {
    current: null as unknown as FakeQuery<unknown[]>,
  },
  chart: null as ChartCapture | null,
  axes: [] as AxisCapture[],
  series: [] as { dataKey: string; hide: boolean }[],
  energyUnit: 'Wh' as 'Wh' | 'kWh',
  repeatedEnergyLabel: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: unknown, options?: unknown) => {
      const fallback = H.repeatedEnergyLabel && _key === 'energyLedger.col.charged'
        ? 'Charged (kWh / kWh)'
        : typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : typeof fallbackOrOptions === 'object'
          && fallbackOrOptions !== null
          && 'defaultValue' in fallbackOrOptions
          ? String((fallbackOrOptions as { defaultValue: unknown }).defaultValue)
          : _key;
      const values = (
        typeof options === 'object' && options !== null
          ? options
          : fallbackOrOptions
      ) as Record<string, unknown> | undefined;
      return values
        ? Object.entries(values).reduce(
            (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
            fallback,
          )
        : fallback;
    },
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: () => H.sessions.current,
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => H.drives.current,
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: H.energyUnit, duration: 's', power: 'W', precision: 1, locale: 'en-US',
    },
    formatEnergy: (value: number) => `${value} Wh`,
    formatPower: (value: number) => `${value} W`,
    formatDistance: (value: number) => `${value} m`,
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useHiddenSeries', () => ({
  useHiddenSeries: () => ({
    isHidden: () => false,
    toggle: vi.fn(),
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Spy at the concrete frame boundary used by ChartCard, retaining its real rendering.
vi.mock('@/components/charts/ChartContainer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts/ChartContainer')>();
  return {
    ...actual,
    ChartContainer: (props: ChartContainerProps) => {
      H.chart = props;
      return <actual.ChartContainer {...props} />;
    },
  };
});

vi.mock('@/components/charts', () => ({
  ChartTooltip: () => null,
  ChartLegend: () => null,
  ComposedChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Bar: (props: { dataKey: string; hide: boolean }) => {
    H.series.push(props);
    return null;
  },
  Line: (props: { dataKey: string; hide: boolean }) => {
    H.series.push(props);
    return null;
  },
  XAxis: (props: AxisCapture) => {
    H.axes.push(props);
    return null;
  },
  YAxis: (props: AxisCapture) => {
    H.axes.push(props);
    return null;
  },
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

import EnergyLedgerPage from './EnergyLedgerPage';

function query<T>(overrides: Partial<FakeQuery<T>> = {}): FakeQuery<T> {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isSuccess: false,
    isError: false,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EnergyLedgerPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  H.chart = null;
  H.axes = [];
  H.series = [];
  H.energyUnit = 'Wh';
  H.repeatedEnergyLabel = false;
  document.documentElement.style.removeProperty('--font-scale');
  document.documentElement.style.removeProperty('--font-sans');
  H.sessions.current = query({ data: [], isSuccess: true });
  H.drives.current = query({
    isError: true,
    error: new Error('drive history offline'),
  });
});

describe('EnergyLedgerPage partial-data contract', () => {
  it('names the failed source, preserves the page, and retries only that source', () => {
    renderPage();

    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Charging history')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Drive history')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Month by Month')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(H.drives.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.sessions.current.refetch).not.toHaveBeenCalled();
  });

  it('retains the accounting shell and four metrics when cached histories fail to refresh', () => {
    H.sessions.current = query({
      data: [], isError: true, error: new Error('cached charging refresh failed'),
    });
    H.drives.current = query({
      data: [], isError: true, error: new Error('cached drive refresh failed'),
    });
    renderPage();

    const summary = screen.getByRole('region', { name: 'Energy ledger metrics' });
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of ['Books Closure', 'Reached the Wheels', 'Vampire Drain', 'Unexplained']) {
      assertOperationalMetricUnavailable(summary, label);
    }
    expect(screen.queryByText('Energy ledger evidence is unavailable.')).not.toBeInTheDocument();
    expect(screen.getByText('Month by Month')).toBeInTheDocument();
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    fireEvent.click(within(warnings[0]).getByRole('button', { name: /refresh/i }));
    expect(H.sessions.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.drives.current.refetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'resolved empty histories', paused: false },
    { name: 'unresolved paused history', paused: true },
  ])('keeps absent readings unknown for $name', ({ paused }) => {
    H.sessions.current = query({ data: [], isSuccess: true });
    H.drives.current = paused
      ? query({ isPending: true, fetchStatus: 'paused' })
      : query({ data: [], isSuccess: true });
    renderPage();

    const summary = screen.getByRole('region', { name: 'Energy ledger metrics' });
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of ['Books Closure', 'Reached the Wheels', 'Vampire Drain', 'Unexplained']) {
      assertOperationalMetricUnavailable(summary, label);
    }
    expect(within(summary).queryByText('0%')).not.toBeInTheDocument();
    expect(within(summary).queryByText('0 Wh/day')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Monthly Balance' })).toBeInTheDocument();
    expect(screen.getByText('Month by Month')).toBeInTheDocument();
  });

  it('gives every dependent section fatal recovery without clearing the healthy source', () => {
    renderPage();

    expect(H.chart?.error).toBe(H.drives.current.error);
    expect(screen.getAllByText('Energy ledger evidence is unavailable.')).toHaveLength(2);
    expect(screen.queryByText('No complete month has been recorded yet.')).not.toBeInTheDocument();
    H.chart?.onRetry?.();
    expect(H.drives.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.sessions.current.refetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'watt-hours', energy: 'Wh' as const, charged: 36_000, driven: -9_000, standby: -3_000, stored: 24_000 },
    { name: 'kilowatt-hours', energy: 'kWh' as const, charged: 36, driven: -9, standby: -3, stored: 24 },
  ])('preserves signed accounting, every series and stored export evidence in $name', ({
    energy, charged, driven, standby, stored,
  }) => {
    H.energyUnit = energy;
    H.sessions.current = query({
      isSuccess: true,
      data: [{
        started_at: '2026-01-02T10:00:00Z', ended_at: '2026-01-02T11:00:00Z',
        total_energy_added_wh: 36_000, start_soc_pct: 20, end_soc_pct: 80,
      }],
    });
    H.drives.current = query({
      isSuccess: true,
      data: [{
        startTs: '2026-01-03T10:00:00Z', endTs: '2026-01-03T11:00:00Z',
        energyUsedWh: 9_000, startBatteryPct: 75, endBatteryPct: 60, distanceM: 50_000,
      }],
    });
    document.documentElement.style.setProperty('--font-scale', '2');
    document.documentElement.style.setProperty('--font-sans', 'Ledger Test Font');
    renderPage();

    expect(H.chart?.chartKey).toBe('energy-ledger-monthly');
    expect(H.chart?.exportable).toBe(true);
    expect(H.chart?.data).toEqual([{
      month: '2026-01', charged, driven, standby, stored, residual: 0,
    }]);
    expect(H.chart?.dataColumns?.map(column => column.key)).toEqual([
      'month', 'charged', 'driven', 'standby', 'stored', 'residual',
    ]);
    expect(H.chart?.dataColumns?.slice(1).map(column => column.label)).toEqual([
      `Charged (${energy})`, `Driven (${energy})`, `Standby (${energy})`,
      `Δ stored (${energy})`, `Residual (${energy})`,
    ]);
    expect(H.series.map(series => series.dataKey)).toEqual(['charged', 'driven', 'standby', 'residual']);
    expect(H.series.every(series => !series.hide)).toBe(true);
    expect(H.axes).toHaveLength(2);
    for (const axis of H.axes) {
      expect(axis.tick).toMatchObject({ fontFamily: 'Ledger Test Font', fontSize: 22 });
    }
    expect(H.axes[1]?.unit).toBe(` ${energy}`);
    expect(screen.getByText('36000 Wh · 1 sessions')).toBeInTheDocument();
    expect(screen.getByText('9000 Wh · 50000 m')).toBeInTheDocument();
    expect(screen.getByText('3000 Wh over 23 h')).toBeInTheDocument();
    expect(screen.getByText('+0 Wh')).toBeInTheDocument();
    const residualMetric = screen.getByRole('region', { name: 'Energy ledger metrics' })
      .querySelector('[data-operational-metric="ledger-residual"]');
    expect(residualMetric).toHaveAttribute('data-value-state', 'value');
    expect(residualMetric).toHaveTextContent('0 Wh');
  });

  it.each(['Wh', 'kWh'] as const)(
    'replaces every translated energy-label occurrence in %s without changing accounting',
    energy => {
      H.energyUnit = energy;
      H.repeatedEnergyLabel = true;
      H.sessions.current = query({
        isSuccess: true,
        data: [{
          started_at: '2026-01-02T10:00:00Z', ended_at: '2026-01-02T11:00:00Z',
          total_energy_added_wh: 36_000, start_soc_pct: 20, end_soc_pct: 80,
        }],
      });
      H.drives.current = query({ data: [], isSuccess: true });
      renderPage();

      expect(H.chart?.dataColumns?.find(column => column.key === 'charged')?.label)
        .toBe(`Charged (${energy} / ${energy})`);
      expect(H.chart?.data?.[0]?.charged).toBe(energy === 'Wh' ? 36_000 : 36);
      expect(screen.getByText('Month by Month')).toBeInTheDocument();
    },
  );

  it('does not claim measured zero vampire drain when no qualifying idle gap exists', () => {
    H.sessions.current = query({
      isSuccess: true,
      data: [{
        started_at: '2026-01-02T10:00:00Z', ended_at: '2026-01-02T11:00:00Z',
        total_energy_added_wh: 36_000, start_soc_pct: 20, end_soc_pct: 80,
      }],
    });
    H.drives.current = query({ data: [], isSuccess: true });
    renderPage();

    const summary = screen.getByRole('region', { name: 'Energy ledger metrics' });
    assertOperationalMetricUnavailable(summary, 'Vampire Drain');
    expect(within(summary).queryByText('0 Wh/day')).not.toBeInTheDocument();
    expect(screen.getByText('36000 Wh · 1 sessions')).toBeInTheDocument();
  });

  it('keeps charged-energy ratios unknown when only driving is recorded', () => {
    H.sessions.current = query({ data: [], isSuccess: true });
    H.drives.current = query({
      isSuccess: true,
      data: [{
        startTs: '2026-01-03T10:00:00Z', endTs: '2026-01-03T11:00:00Z',
        energyUsedWh: 9_000, startBatteryPct: 75, endBatteryPct: 60, distanceM: 50_000,
      }],
    });
    renderPage();

    const summary = screen.getByRole('region', { name: 'Energy ledger metrics' });
    for (const label of ['Books Closure', 'Reached the Wheels']) {
      assertOperationalMetricUnavailable(summary, label);
    }
    expect(within(summary).queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getByText('9000 Wh · 50000 m')).toBeInTheDocument();
  });
});
