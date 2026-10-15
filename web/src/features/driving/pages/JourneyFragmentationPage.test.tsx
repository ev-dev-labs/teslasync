import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { DataState } from '@/api/dataState';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import { getGlobalLocale, getGlobalPrecision, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { AccountingPanel } from '../components/journey-fragmentation/AccountingPanel';
import { analyzeJourneyFragmentation } from '../lib/journeyFragmentation';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as QueryStub | undefined,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
  locale: 'en-US',
  failedChartTitle: null as string | null,
  gapMinutesTemplate: '{{count}} min',
}));
const refetch = vi.fn();

interface QueryStub {
  data: Drive[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
  fetchStatus?: 'idle' | 'fetching' | 'paused';
  isFetching?: boolean;
  isPending?: boolean;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: unknown) => {
      const text = key === 'journeyFragmentation.gapMinutes'
        ? h.gapMinutesTemplate
        : typeof fallback === 'string' ? fallback : key;
      const values = options && typeof options === 'object'
        ? options as Record<string, unknown>
        : {};
      const replacements = values.replace && typeof values.replace === 'object'
        ? values.replace as Record<string, unknown>
        : values;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        replacements[name] == null ? '' : String(replacements[name]));
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
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: vi.fn() }));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'user', timezone_user: 'Asia/Tokyo' },
    locale: h.locale,
  }),
}));

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

vi.mock('@/components/ui', async () => {
  const { Select } = await vi.importActual<typeof import('@/components/ui/Select')>(
    '@/components/ui/Select',
  );
  interface Props {
    as?: keyof JSX.IntrinsicElements;
    children?: ReactNode;
    [key: string]: unknown;
  }
  const Text = ({ as = 'span', children }: Props) => createElement(as, {}, children);
  const GlassPanel = ({ children }: { children: ReactNode }) => (
    <section data-testid="analytical-shell">{children}</section>
  );
  const MetricValue = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    GlassPanel, MetricValue, Select, Text,
    Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button type="button" onClick={onClick}>{children}</button>
    ),
  };
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

vi.mock('@/components/feedback', async () => {
  const { SectionErrorBoundary } = await vi.importActual<typeof import('@/components/feedback/SectionErrorBoundary')>(
    '@/components/feedback/SectionErrorBoundary',
  );
  const { Skeleton } = await vi.importActual<typeof import('@/components/feedback/Skeleton')>(
    '@/components/feedback/Skeleton',
  );
  return {
  SectionErrorBoundary,
  Skeleton,
  AlertBanner: ({ children, title }: { children: ReactNode; title?: string }) => (
    <div role="status">{title}{children}</div>
  ),
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
  };
});

vi.mock('@/components/charts', () => {
  interface ChartProps {
    title: string;
    subtitle?: string;
    ariaLabel: string;
    loading?: boolean;
    empty?: boolean;
    children?: ReactNode | ((context: { hiddenSeries: null }) => ReactNode);
    data?: ReadonlyArray<Record<string, unknown>>;
  }
  const ChartContainer = ({ title, subtitle, ariaLabel, loading, empty, children, data }: ChartProps) => {
    if (h.failedChartTitle === title) throw new Error('Synthetic chart rendering failure');
    return (
    <section data-testid="analytical-shell" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
      {loading ? <p>Loading</p> : empty ? <p>No data available</p> : data ? (
        <div role="img" aria-label={ariaLabel}>
          <output aria-label={`${title} data`}>{JSON.stringify(data)}</output>
          {typeof children === 'function' ? children({ hiddenSeries: null }) : children}
        </div>
      ) : typeof children === 'function' ? children({ hiddenSeries: null }) : children}
    </section>
    );
  };
  const ResponsiveContainer = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const passthrough = () => null;
  return {
    Bar: passthrough,
    BarChart: passthrough,
    ChartContainer,
    ChartTooltip: passthrough,
    ChartLegend: passthrough,
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
  expect(screen.getAllByTestId('analytical-shell')).toHaveLength(13);
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

function elapsedBrief() {
  return screen.getByRole('region', { name: 'Linked journey timing' });
}

function elapsedValues() {
  return Array.from(elapsedBrief().querySelectorAll('[data-operational-value]'),
    element => element.textContent);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/journey-fragmentation']}>
        <JourneyFragmentationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(page());
  return { ...rendered, rerenderPage: () => rendered.rerender(page()) };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  h.locale = 'en-US';
  h.failedChartTitle = null;
  h.gapMinutesTemplate = '{{count}} min';
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
  it('uses one elapsed analysis surface while preserving scope, metrics, explanations, and review provenance', () => {
    renderPage();

    const composition = screen.getByRole('heading', { name: 'Elapsed composition' })
      .parentElement!.parentElement!;
    const brief = elapsedBrief();
    const explanation = 'Driving time and observed parking time allocated only across linked journey pairs.';
    const provenance = 'Parking intervals retained inside observed chains';

    expect(within(composition).getAllByTestId('analytical-shell')).toHaveLength(1);
    expect(within(composition).getAllByRole('region')).toEqual([brief]);
    expect(within(composition).getAllByText(explanation)).toHaveLength(2);
    expect(within(brief).getByText('Elapsed composition')).toBeInTheDocument();
    expect(within(brief).getByText('Returned evidence')).toBeInTheDocument();
    expect(within(brief).getByText(provenance)).toBeInTheDocument();
    expect(elapsedValues()).toEqual(['90 min', '30 min', '1']);

    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog');
    expect(within(details).getByText('Linked journey timing details')).toBeInTheDocument();
    expect(within(details).getByText('Elapsed composition')).toBeInTheDocument();
    expect(within(details).getByText('Returned evidence')).toBeInTheDocument();
    expect(within(details).getAllByText(explanation).length).toBeGreaterThan(0);
    expect(within(details).getAllByText(provenance).length).toBeGreaterThan(0);
  });

  it('uses neutral surfaces and subtle borders for every accounting category without changing counts or layout', () => {
    const result = analyzeJourneyFragmentation(
      readyHistory(), FROZEN_NOW, 'America/Los_Angeles',
    );
    const snapshot = structuredClone(result);
    render(<AccountingPanel result={result} />);

    const categories = [
      ['Included', result.rowAccounting.included],
      ['Incomplete / live', result.rowAccounting.incompleteLive],
      ['Invalid timestamp / order', result.rowAccounting.invalidTimestampOrder],
      ['Future', result.rowAccounting.future],
      ['Invalid duration', result.rowAccounting.invalidDuration],
      ['Excluded', result.rowAccounting.excluded],
      ['Linked', result.pairAccounting.linked],
      ['Unusable / source boundary', result.pairAccounting.unusableSourceBoundary],
      ['Unlocatable endpoint', result.pairAccounting.unlocatableEndpoint],
      ['Endpoint mismatch', result.pairAccounting.endpointMismatch],
      ['Overlap / negative gap', result.pairAccounting.overlapNegativeGap],
      ['Over selected gap', result.pairAccounting.overSelectedGap],
    ] as const;
    for (const [label, value] of categories) {
      const cell = screen.getByText(label).parentElement!;
      expect(cell).toHaveClass(
        'rounded-lg', 'border', 'border-[var(--border-subtle)]',
        'bg-[var(--surface-2)]', 'p-2',
      );
      expect(within(cell).getByText(String(value))).toBeInTheDocument();
      expect(cell.parentElement).toHaveClass('grid', 'grid-cols-2', 'gap-2');
    }
    expect(screen.getByText(`Returned rows: ${result.returnedRows}`)).toBeInTheDocument();
    expect(screen.getByText(`Adjacent pairs: ${result.pairAccounting.totalAdjacentPairs}`)).toBeInTheDocument();
    expect(result).toEqual(snapshot);
  });

  it.each(['de-DE', 'en-US'])('formats accounting with saved %s locale and its hour cycle in the source timezone', (locale) => {
    h.locale = locale;
    h.timeZone = 'Asia/Tokyo';
    const previousLocale = getGlobalLocale();
    const previousPrecision = getGlobalPrecision();
    setGlobalLocale(locale);
    setGlobalPrecision(3);
    const start = '2026-08-02T06:45:00.000Z';
    const end = '2026-08-02T07:15:00.000Z';
    const result = analyzeJourneyFragmentation(
      [driveAt(start)], FROZEN_NOW, 'America/Los_Angeles',
    );
    const snapshot = structuredClone(result);
    try {
      render(<AccountingPanel result={result} />);
      const format = (value: string) => new Intl.DateTimeFormat(locale, {
        timeZone: result.timeZone,
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(value));
      expect(screen.getByText(
        `Returned span: ${format(start)} – ${format(end)}. Included span: ${format(start)} – ${format(end)}.`,
      )).toBeInTheDocument();
      expect(screen.getByText('Returned rows: 1')).toBeInTheDocument();
      expect(screen.getByText('Adjacent pairs: 0')).toBeInTheDocument();
      const days = result.daysSinceLatestIncludedDrive!.toLocaleString(locale, {
        minimumFractionDigits: 3, maximumFractionDigits: 3,
      });
      expect(screen.getByText(
        `${days} days since the latest included drive; 1 active local days and 1 active local weeks.`,
      )).toBeInTheDocument();
      expect(result).toEqual(snapshot);
      expect(result.timeZone).toBe('America/Los_Angeles');
    } finally {
      setGlobalLocale(previousLocale);
      setGlobalPrecision(previousPrecision);
    }
  });

  it('shows accounting placeholders for missing, invalid, and out-of-range dates without substituting epoch zero', () => {
    const result = analyzeJourneyFragmentation(readyHistory(), FROZEN_NOW, h.timeZone);
    result.returnedSpanStartMs = null;
    result.returnedSpanEndMs = Number.NaN;
    result.includedSpanStartMs = Number.POSITIVE_INFINITY;
    result.includedSpanEndMs = 8.64e15 + 1;
    result.daysSinceLatestIncludedDrive = null;
    render(<AccountingPanel result={result} />);
    expect(screen.getByText('Returned span: — – —. Included span: — – —.')).toBeInTheDocument();
    expect(screen.getByText(/^— days since the latest included drive/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date|1970/)).not.toBeInTheDocument();
  });

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
    expect(screen.queryByText('No returned drive rows are available for this vehicle yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(h.historyHook).toHaveBeenCalledWith(undefined, 1_000);
  });

  it.each([
    { groups: 0, label: 'Unavailable', difference: '—' },
    { groups: 1, label: 'Thin', difference: '0.00 kWh / km' },
    { groups: 2, label: 'Thin', difference: '0.00 kWh / km' },
    { groups: 3, label: 'Supported', difference: '0.00 kWh / km' },
  ])('shows the human energy support label $label without changing populated metrics', ({ groups, label, difference }) => {
    const data = groups === 0 ? [driveAt('2026-08-01T08:00:00.000Z')] :
      Array.from({ length: groups }, (_, index) => {
        const day = `2026-08-${String(index + 1).padStart(2, '0')}`;
        return [
          driveAt(`${day}T08:00:00.000Z`, { endAddress: 'A' }),
          driveAt(`${day}T09:00:00.000Z`, { startAddress: 'A', endAddress: 'B' }),
          driveAt(`${day}T14:00:00.000Z`),
        ];
      }).flat();
    h.history = { data, isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    const brief = screen.getByRole('region', { name: 'Whole-journey intensity' });
    expect(within(brief).getByText(
      `Support band: ${label}; recommended minimum: 3 complete-energy journeys per group`,
    )).toBeInTheDocument();
    const metric = within(brief).getByText('Observed energy-intensity difference')
      .closest('[data-operational-metric]');
    expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent(difference);
    expect(within(brief).getByText('Single-drive journeys')).toBeInTheDocument();
    expect(within(brief).getByText('Multi-drive journeys')).toBeInTheDocument();
    expect(h.historyHook).toHaveBeenCalledWith('7', 1_000);
  });

  it('keeps all shells visible during selected-vehicle loading', () => {
    h.history = { data: undefined, isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching', isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getAllByText('Loading').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByText(/across 0 linked gaps/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(metricValue('Observed journeys')).toBe('—');
    expect(elapsedBrief()).toHaveAttribute('aria-busy', 'true');
    expect(within(elapsedBrief()).getByText('Loading source')).toBeInTheDocument();
    expect(elapsedValues()).toEqual([]);
    expect(elapsedBrief().querySelectorAll('[data-operational-metric]')).toHaveLength(3);
  });

  it('keeps all shells visible and shows one retry on initial query error', () => {
    h.history = { data: undefined, isLoading: false, isError: true, error: new Error('network'), refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expectOneRecoveryControl();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(metricValue('Observed journeys')).toBe('—');
    expect(within(elapsedBrief()).getByText('Source unavailable')).toBeInTheDocument();
    expect(elapsedValues()).toEqual(['—', '—', '—']);
  });

  it('keeps all shells visible for selected-vehicle empty history', () => {
    h.history = { data: [], isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(screen.getByText('No returned drive rows are available for this vehicle yet.')).toBeInTheDocument();
    expect(screen.getAllByText('No data available').length).toBeGreaterThanOrEqual(5);
    expect(metricValue('Observed journeys')).toBe('0');
    expect(metricValue('Linked pairs')).toBe('0');
    expect(within(elapsedBrief()).getByText('Returned evidence')).toBeInTheDocument();
    expect(elapsedValues()).toEqual(['0 min', '0 min', '0']);
    expect(screen.queryByText('Drive evidence is not available yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
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
    expect(elapsedValues()).toEqual(['90 min', '0 min', '0']);
    expect(within(elapsedBrief()).getByText('Returned evidence')).toBeInTheDocument();
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
    expect(elapsedValues()).toEqual(['90 min', '30 min', '1']);
    expect(within(elapsedBrief()).getByText('Retained source')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Retry|Refresh)$/ })).toHaveLength(1);
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

  it('localizes sensitivity thresholds with canonical minute interpolation without changing counts', () => {
    const previousLocale = getGlobalLocale();
    setGlobalLocale('ar-EG');
    h.gapMinutesTemplate = 'Minutes: {{count}}';
    h.history = { data: thresholdHistory(), isLoading: false, isError: false, error: null, refetch };
    const { unmount } = renderPage();
    try {
      expect(JSON.parse(screen.getByLabelText('Threshold sensitivity data').textContent ?? 'null'))
        .toEqual([
          { threshold: 'Minutes: ٣٠', journeys: 3, linkedPairs: 0 },
          { threshold: 'Minutes: ٦٠', journeys: 2, linkedPairs: 1 },
          { threshold: 'Minutes: ١٢٠', journeys: 2, linkedPairs: 1 },
          { threshold: 'Minutes: ٢٤٠', journeys: 2, linkedPairs: 1 },
        ]);
      expect(metricValue('Linked pairs')).toBe('1');
      expect(metricValue('Observed journeys')).toBe('2');
      expect(h.historyHook).toHaveBeenCalledWith('7', 1_000);
    } finally {
      unmount();
      setGlobalLocale(previousLocale);
    }
  });

  it('labels the native threshold control visibly and preserves all four choices', () => {
    renderPage();
    const selector = screen.getByRole('combobox', { name: 'Maximum parking gap' });
    expect(screen.getByText('Maximum parking gap', { selector: 'label' })).toBeVisible();
    expect(selector).toHaveValue('120');
    expect(within(selector).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['30 min', '60 min', '120 min', '240 min']);
    expect(selector).toHaveClass('min-h-11', 'md:min-h-9');
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it('keeps unresolved report context distinct from an authoritatively empty response', () => {
    h.history = { data: undefined, isLoading: true, isError: false, error: null, refetch };
    const { rerenderPage } = renderPage();
    const context = screen.getByRole('heading', { name: 'Report context' }).closest('section');
    if (!context) throw new Error('Report context shell is missing');
    expect(context.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(within(context).getByText('Drive evidence is not available yet.')).toBeInTheDocument();
    expect(within(context).queryByText('No returned drive rows are available for this vehicle yet.')).not.toBeInTheDocument();

    h.history = { data: [], isLoading: false, isError: false, error: null, refetch };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expect(within(context).getByText('No returned drive rows are available for this vehicle yet.')).toBeInTheDocument();
    expect(context.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
  });

  it('keeps initial failure context unknown and retries only the actual source', () => {
    h.history = { data: undefined, isLoading: false, isError: true, error: new Error('source unavailable'), refetch };
    renderPage();
    expectPersistentAnalyticalShells();
    const context = screen.getByRole('heading', { name: 'Report context' }).closest('section');
    if (!context) throw new Error('Report context shell is missing');
    expect(within(context).getByText('Drive evidence is not available yet.')).toBeInTheDocument();
    expect(within(context).queryByText('No returned drive rows are available for this vehicle yet.')).not.toBeInTheDocument();
    expectOneRecoveryControl();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not claim loading completion or measured zero when the first request is paused', () => {
    h.history = {
      data: undefined, isLoading: false, isError: false,
      error: null, refetch, fetchStatus: 'paused',
    };
    renderPage();
    expectPersistentAnalyticalShells();
    expect(metricValue('Observed journeys')).toBe('—');
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    expect(elapsedBrief()).not.toHaveAttribute('aria-busy');
    expect(within(elapsedBrief()).getByText('Source unavailable')).toBeInTheDocument();
    expect(elapsedValues()).toEqual(['—', '—', '—']);
    expect(screen.getAllByText('The initial evidence query is paused; no empty result is inferred.').length).toBeGreaterThan(1);
    expectOneRecoveryControl();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it('recovers from paused and fatal initial states into authoritative empty evidence', () => {
    h.history = { data: undefined, isLoading: false, isPending: true, isError: false, error: null, refetch, fetchStatus: 'paused' };
    const { rerenderPage } = renderPage();
    expectOneRecoveryControl();
    expect(metricValue('Observed journeys')).toBe('—');
    h.history = { ...h.history, fetchStatus: 'idle', isPending: false, isError: true, error: new Error('network') };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expectOneRecoveryControl();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    h.history = { ...h.history, data: [], isError: false, error: null };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expect(metricValue('Observed journeys')).toBe('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Retry|Refresh)$/ })).not.toBeInTheDocument();
  });

  it('retains every populated payload through refresh failure and clears warnings on recovery', () => {
    const data = readyHistory();
    h.history = { data, isLoading: false, isError: false, error: null, refetch };
    const { rerenderPage } = renderPage();
    const chartPayloads = () => screen.getAllByRole('img').map(element => element.textContent);
    const payloads = chartPayloads();
    const observedJourneys = metricValue('Observed journeys');
    const elapsed = elapsedValues();
    expect(elapsed).toEqual(['90 min', '30 min', '1']);
    h.history = { ...h.history, isError: true, error: new Error('refresh') };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expect(chartPayloads()).toEqual(payloads);
    expect(metricValue('Observed journeys')).toBe(observedJourneys);
    expect(elapsedValues()).toEqual(elapsed);
    expect(within(elapsedBrief()).getByText('Retained source')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Retry|Refresh)$/ })).toHaveLength(1);
    expect(screen.getByText('Retained evidence')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    h.history = { ...h.history, isError: false, error: null, isFetching: true };
    rerenderPage();
    expect(chartPayloads()).toEqual(payloads);
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
    expect(elapsedValues()).toEqual(elapsed);
    expect(elapsedBrief()).not.toHaveAttribute('aria-busy');
    h.history = { ...h.history, isFetching: false };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expect(chartPayloads()).toEqual(payloads);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained evidence')).not.toBeInTheDocument();
    expect(elapsedValues()).toEqual(elapsed);
    expect(within(elapsedBrief()).getByText('Returned evidence')).toBeInTheDocument();
    expect(within(elapsedBrief()).queryByText('Retained source')).not.toBeInTheDocument();
  });

  it('retains an authoritative empty result through refresh failure and recovery', () => {
    h.history = { data: [], isLoading: false, isError: false, error: null, refetch };
    const { rerenderPage } = renderPage();
    h.history = { ...h.history, isError: true, error: new Error('refresh') };
    rerenderPage();
    expectPersistentAnalyticalShells();
    expect(metricValue('Observed journeys')).toBe('0');
    expect(elapsedValues()).toEqual(['0 min', '0 min', '0']);
    expect(within(elapsedBrief()).getByText('Retained source')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('No returned drive rows are available for this vehicle yet.')).toBeInTheDocument();
    h.history = { ...h.history, isError: false, error: null };
    rerenderPage();
    expect(metricValue('Observed journeys')).toBe('0');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(elapsedValues()).toEqual(['0 min', '0 min', '0']);
    expect(within(elapsedBrief()).getByText('Returned evidence')).toBeInTheDocument();
  });

  it('preserves exact gap boundaries, chronological grouping and the unchanged capped query', () => {
    const first = driveAt('2026-08-01T08:00:00.000Z', { endAddress: 'Parking A' });
    const second = driveAt('2026-08-01T10:30:00.000Z', { startAddress: 'Parking A', endAddress: 'Parking B' });
    const third = driveAt('2026-08-01T13:00:00.001Z', { startAddress: 'Parking B' });
    const source = [third, first, second];
    h.history = { data: source, isLoading: false, isError: false, error: null, refetch };
    renderPage();
    expect(metricValue('Linked pairs')).toBe('1');
    expect(metricValue('Observed journeys')).toBe('2');
    expect(screen.getByLabelText('Chain-length distribution data')).toHaveTextContent(
      '[{"fragments":"1","journeys":1},{"fragments":"2","journeys":1}]',
    );
    fireEvent.change(screen.getByLabelText('Maximum parking gap'), { target: { value: '240' } });
    expect(metricValue('Linked pairs')).toBe('2');
    expect(metricValue('Observed journeys')).toBe('1');
    expect(screen.getByLabelText('Chain-length distribution data')).toHaveTextContent(
      '[{"fragments":"3","journeys":1}]',
    );
    expect(source.map((drive) => drive.id)).toEqual([third.id, first.id, second.id]);
    expect(h.historyHook.mock.calls.every(([id, limit]) => id === '7' && limit === 1_000)).toBe(true);
  });

  it('preserves all local start buckets across daylight saving and timezone changes', () => {
    h.history = {
      data: [
        driveAt('2026-03-08T09:30:00.000Z', { endAddress: 'Separate endpoint' }),
        driveAt('2026-03-08T10:30:00.000Z', { startAddress: 'Different endpoint' }),
      ],
      isLoading: false, isError: false, error: null, refetch,
    };
    const { rerenderPage } = renderPage();
    const profile = screen.getByLabelText('Local two-hour journey-start profile data');
    expect(profile).toHaveTextContent('"period":"00:00","journeys":1');
    expect(profile).toHaveTextContent('"period":"02:00","journeys":1');
    expect(profile.textContent?.match(/"period":/g)).toHaveLength(12);
    expect(metricValue('Observed journeys')).toBe('2');
    h.timeZone = 'UTC';
    rerenderPage();
    expect(profile).toHaveTextContent('"period":"08:00","journeys":1');
    expect(profile).toHaveTextContent('"period":"10:00","journeys":1');
    expect(metricValue('Observed journeys')).toBe('2');
  });

  it('isolates one failed widget and restores it without refetching or removing neighboring sections', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.failedChartTitle = 'Chain-length distribution';
    renderPage();
    expect(screen.getAllByTestId('analytical-shell')).toHaveLength(13);
    expect(screen.getByRole('heading', { name: 'Stopover-gap distribution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Methodology and interpretation limits' })).toBeInTheDocument();
    expect(metricValue('Observed journeys')).toBe('2');
    h.failedChartTitle = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expectPersistentAnalyticalShells();
    expect(refetch).not.toHaveBeenCalled();
  });
});
