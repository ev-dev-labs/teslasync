import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { DataState } from '@/api/dataState';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as QueryStub | undefined,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
}));
const refetch = vi.fn();

interface QueryStub {
  data: Drive[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  fetchStatus?: 'idle' | 'fetching' | 'paused';
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const values = options && typeof options === 'object'
        ? options as Record<string, unknown>
        : {};
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        values[name] == null ? '' : String(values[name]));
    },
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (vehicleId?: string, limit?: number) => {
    h.historyHook(vehicleId, limit);
    return h.history ?? {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: { timezone: h.timeZone },
    vehicles: [{ id: 7, display_name: 'Test vehicle', vin: 'TEST' }],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: (mode: string) => {
    h.timezoneHook(mode);
    return h.timeZone;
  },
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', energy: 'kWh' },
    formatDistance: (value: number | null | undefined) => value == null ? '—' : `${(value / 1000).toFixed(1)} km`,
    formatEnergy: (value: number | null | undefined) => value == null ? '—' : `${(value / 1000).toFixed(2)} kWh`,
    formatDuration: (value: number | null | undefined) => value == null ? '—' : `${Math.round(value / 60)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle select</div>,
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    children,
    contextActions,
    query,
  }: {
    children: ReactNode;
    contextActions?: ReactNode;
    query?: { refetch: () => Promise<unknown> };
  }) => (
    <main>
      {query && <span data-testid="page-query-freshness">Freshness</span>}
      {contextActions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <section data-testid="analytical-shell"><h2>{title}</h2>{children}</section>
  ),
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui', () => {
  interface Props {
    as?: keyof JSX.IntrinsicElements;
    children?: ReactNode;
    [key: string]: unknown;
  }
  const Text = ({ as = 'span', children }: Props) => createElement(as, {}, children);
  const GlassPanel = ({ children }: { children: ReactNode }) => (
    <section data-testid="analytical-shell">{children}</section>
  );
  const Select = ({
    options,
    value,
    onChange,
    ...props
  }: {
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (event: { target: { value: string } }) => void;
    'aria-label': string;
  }) => (
    <select {...props} value={value} onChange={onChange}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
  const MetricValue = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { GlassPanel, MetricValue, Select, Text };
});

vi.mock('@/components/data-display', async () => {
  const { OperationalBrief } = await vi.importActual<typeof import('@/components/data-display/OperationalBrief')>(
    '@/components/data-display/OperationalBrief',
  );
  return {
    OperationalBrief: (props: OperationalBriefProps) => (
      <div data-testid={props.title === 'Journey evidence and summary' ? 'analytical-shell' : undefined}>
        <OperationalBrief {...props} />
      </div>
    ),
    MetricCard: ({ label, value, subtitle }: { label: string; value: ReactNode; subtitle?: string }) => (
      <div data-testid={`metric-${label}`}><span>{label}</span><strong>{value}</strong><small>{subtitle}</small></div>
    ),
  };
});

vi.mock('@/components/feedback', () => ({
  StaleRefreshWarning: ({ state }: { state: DataState<Drive[]> }) =>
    state.hasData && (state.refreshError || state.isRefreshBlocked) ? (
      <div role="status" data-testid="stale-refresh-warning">
        {state.isRefreshBlocked ? 'offline' : 'Refresh failed'}
        <button type="button" onClick={() => state.retry?.()}>Refresh</button>
      </div>
    ) : null,
  EmptyState: ({ message }: { message: string }) => <div role="status">{message}</div>,
  QueryError: ({ onRetry }: { onRetry?: () => void }) => (
    <div role="alert"><button type="button" onClick={onRetry}>Retry</button></div>
  ),
}));

vi.mock('@/components/charts', () => {
  interface ChartProps {
    title: string;
    subtitle?: string;
    ariaLabel: string;
    loading?: boolean;
    empty?: boolean;
    children?: ReactNode;
    data?: ReadonlyArray<Record<string, unknown>>;
  }
  const ChartContainer = ({ title, subtitle, ariaLabel, loading, empty, children }: ChartProps) => (
    <section data-testid="analytical-shell" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
      {loading ? <p>Loading</p> : empty ? <p>No data available</p> : <div role="img" aria-label={ariaLabel}>{children}</div>}
    </section>
  );
  const ResponsiveContainer = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const passthrough = () => null;
  return {
    Bar: passthrough,
    BarChart: passthrough,
    ChartContainer,
    ChartTooltip: passthrough,
    ResponsiveContainer,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    axisTick: {},
    chartGrid: null,
    CHART_COLORS: ['#00d4ff', '#22c55e', '#a855f7', '#f59e0b', '#ec4899', '#64748b'],
  };
});

import JourneyFragmentationPage from './JourneyFragmentationPage';

let nextId = 1;

function driveAt(
  startTs: string,
  overrides: Partial<Drive> = {},
): Drive {
  const durationS = overrides.durationS ?? 1_800;
  const start = Date.parse(startTs);
  return {
    id: nextId++,
    vehicleId: 7,
    startTs,
    endTs: new Date(start + durationS * 1_000).toISOString(),
    durationS,
    distanceM: 10_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
  };
}

function readyHistory(): Drive[] {
  return [
    driveAt('2026-08-01T08:00:00.000Z', { endAddress: 'A' }),
    driveAt('2026-08-01T09:00:00.000Z', { startAddress: 'A', endAddress: 'B' }),
    driveAt('2026-08-02T10:00:00.000Z'),
  ];
}

function thresholdHistory(): Drive[] {
  return [
    driveAt('2026-08-01T08:00:00.000Z', {
      endAddress: 'Shared parking',
      endLat: 37,
      endLon: -122,
    }),
    driveAt('2026-08-01T09:15:00.000Z', {
      startAddress: 'shared PARKING',
      startLat: 37.001,
      startLon: -122,
      endAddress: 'Office',
      endLat: 37.2,
      endLon: -122.2,
    }),
    driveAt('2026-08-01T12:00:00.000Z', {
      startAddress: 'Home',
      startLat: 38,
      startLon: -123,
      endAddress: 'Gym',
      endLat: 38.2,
      endLon: -123.2,
    }),
  ];
}

function expectPersistentAnalyticalShells() {
  expect(screen.getAllByTestId('analytical-shell')).toHaveLength(14);
  expect(within(screen.getByRole('region', { name: 'Journey evidence and summary' }))
    .getByText('Observed history window')).toBeInTheDocument();
  [
    'Chain-length distribution',
    'Stopover-gap distribution',
    'Threshold sensitivity',
    'Elapsed composition',
    'Short-fragment and chain structure',
    'Observed energy-intensity comparison',
    'Local two-hour journey-start profile',
    'Weekday journey-start profile',
    'Monthly observed trend',
    'Ranked observed journey directory',
    'Evidence and continuity accounting',
    'Methodology and interpretation limits',
  ].forEach((title) => expect(screen.getByRole('heading', { name: title })).toBeInTheDocument());
  expect(screen.queryAllByTestId('page-query-refresh')).toHaveLength(0);
}

function expectOneRecoveryControl() {
  expect(screen.getAllByRole('button', { name: /^(Retry|Refresh)$/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
}

function metricValue(label: string): string | null {
  return within(screen.getByRole('region', { name: 'Journey evidence and summary' }))
    .getByText(label).closest('[data-operational-metric]')
    ?.querySelector('[data-operational-value]')?.textContent ?? null;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/journey-fragmentation']}>
        <JourneyFragmentationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  h.history = {
    data: readyHistory(),
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  };
  h.historyHook.mockClear();
  h.timezoneHook.mockClear();
  refetch.mockClear();
});

describe('JourneyFragmentationPage', () => {
  it('renders every persistent analytical shell, requests 1,000 rows, and uses vehicle time', () => {
    renderPage();
    expect(h.historyHook).toHaveBeenCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expectPersistentAnalyticalShells();
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/days since the latest included drive/)).toBeInTheDocument();
  });

  it('keeps all shells visible without a selected vehicle', () => {
    h.vehicleId = null;
    h.history = { data: undefined, isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('Choose a vehicle to populate this observed history window.')).toBeInTheDocument();
    expect(screen.getByText('No returned drive rows are available for this vehicle yet.')).toBeInTheDocument();
    expect(h.historyHook).toHaveBeenCalledWith(undefined, 1_000);
  });

  it('keeps all shells visible during selected-vehicle loading', () => {
    h.history = { data: undefined, isLoading: true, isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getAllByText('Loading').length).toBeGreaterThanOrEqual(5);
  });

  it('keeps all shells visible and shows one retry on initial query error', () => {
    h.history = { data: undefined, isLoading: false, isError: true, error: new Error('network'), refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expectOneRecoveryControl();
  });

  it('keeps all shells visible for selected-vehicle empty history', () => {
    h.history = { data: [], isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('No returned drive rows are available for this vehicle yet.')).toBeInTheDocument();
    expect(screen.getAllByText('No data available').length).toBeGreaterThanOrEqual(5);
  });

  it('keeps all shells visible for a returned window with no continuity links', () => {
    h.history = {
      data: [
        driveAt('2026-08-01T08:00:00.000Z', { endAddress: 'A', endLat: 37, endLon: -122 }),
        driveAt('2026-08-01T09:00:00.000Z', { startAddress: 'B', startLat: 38, startLon: -123 }),
        driveAt('2026-08-01T10:00:00.000Z', { startAddress: 'C', startLat: 39, startLon: -124 }),
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('Observed window')).toBeInTheDocument();
    expect(metricValue('Linked pairs')).toBe('0');
  });

  it('keeps all shells visible and labels a thin observed window', () => {
    h.history = {
      data: [driveAt('2026-08-01T08:00:00.000Z')],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('Thin observed window')).toBeInTheDocument();
  });

  it('keeps all shells visible and labels a capped observed window', () => {
    h.history = {
      data: Array.from({ length: 1_000 }, (_, index) =>
        driveAt(`2026-08-${String((index % 7) + 1).padStart(2, '0')}T08:00:00.000Z`, {
          startAddress: `Start ${index}`,
          endAddress: `End ${index}`,
        })),
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('Capped observed window')).toBeInTheDocument();
    const summary = within(screen.getByRole('region', { name: 'Journey evidence and summary' }));
    expect(summary.getByText(/history cap was reached/)).toBeInTheDocument();
    expect(summary.getAllByText('0', { selector: '[data-operational-value]' }).length).toBeGreaterThanOrEqual(2);
  });

  it('preserves cached data and shows one retry on refresh error', () => {
    h.history = { data: readyHistory(), isLoading: false, isError: true, error: new Error('refresh'), refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Refresh failed');
    expect(screen.getByText('Observed journeys')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps every analytical shell and observed result when refresh is paused', () => {
    h.history = {
      data: readyHistory(), isLoading: false, isError: false,
      error: null, refetch, fetchStatus: 'paused',
    };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('Observed journeys')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('offline');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('changes the visible linked-pair and journey metrics at a 30-minute threshold', () => {
    h.history = {
      data: thresholdHistory(),
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
    renderPage();
    expect(metricValue('Linked pairs')).toBe('1');
    expect(metricValue('Observed journeys')).toBe('2');
    const selector = screen.getByLabelText('Maximum parking gap');
    fireEvent.change(selector, { target: { value: '30' } });
    expect(selector).toHaveValue('30');
    expect(metricValue('Linked pairs')).toBe('0');
    expect(metricValue('Observed journeys')).toBe('3');
  });
});
