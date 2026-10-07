import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-12-31T23:59:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'UTC',
  hiddenSeries: new Set<string>(),
}));
const refetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const values = options && typeof options === 'object'
        ? options as Record<string, unknown>
        : {};
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        values[name] != null ? String(values[name]) : '');
    },
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.historyHook(vehicleId, limit);
      return h.history;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: h.vehicleId == null ? [] : [{ id: 7, display_name: 'Test Vehicle', vin: 'TEST' }],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: (mode: string) => {
    h.timezoneHook(mode);
    return h.timeZone;
  },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'kPa',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatDistance: (value: number | null | undefined) =>
      value == null ? '—' : `${(value / 1_000).toFixed(0)} km`,
    formatEnergy: (value: number | null | undefined) =>
      value == null ? '—' : `${(value / 1_000).toFixed(1)} kWh`,
    formatDuration: (value: number | null | undefined) =>
      value == null ? '—' : `${(value / 3_600).toFixed(1)} h`,
    formatSpeed: vi.fn(),
    formatTemperature: vi.fn(),
    formatPressure: vi.fn(),
    formatPower: vi.fn(),
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/charts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const series = ({
    dataKey,
    hide,
    children,
  }: {
    dataKey?: string;
    hide?: boolean;
    children?: ReactNode;
  }) => (
    <div data-testid={`seasonal-series-${dataKey ?? 'unknown'}`} data-hidden={String(Boolean(hide))}>
      {children}
    </div>
  );
  return {
    CHART_COLORS: ['#00b4d8', '#10b981', '#8b5cf6', '#f59e0b', '#38bdf8'],
    ChartContainer: ({
      title,
      ariaLabel,
      children,
      data,
    }: {
      title: string;
      ariaLabel: string;
      children?: ReactNode | ((context: { hiddenSeries: { isHidden: (key: string) => boolean } }) => ReactNode);
      data?: unknown[];
    }) => (
      <figure role="img" aria-label={ariaLabel} data-chart-rows={data?.length ?? 0}>
        <figcaption>{title}</figcaption>
        {typeof children === 'function'
          ? children({ hiddenSeries: { isHidden: (key) => h.hiddenSeries.has(key) } })
          : children}
      </figure>
    ),
    Area: passthrough,
    AreaChart: passthrough,
    Bar: series,
    BarChart: passthrough,
    CartesianGrid: passthrough,
    ChartLegend: passthrough,
    ChartTooltip: passthrough,
    Line: series,
    LineChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

import SeasonalEfficiencyPage from './SeasonalEfficiencyPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function query(overrides: Partial<QueryStub> = {}): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch,
    ...overrides,
  };
}

let nextId = 1;
function driveAt(startTs: string, overrides: Partial<Drive> = {}): Drive {
  const durationS = overrides.durationS ?? 1_800;
  const endTs = overrides.endTs === undefined
    ? new Date(Date.parse(startTs) + durationS * 1_000).toISOString()
    : overrides.endTs;
  return {
    id: nextId++,
    vehicleId: 7,
    startTs,
    endTs,
    durationS,
    distanceM: 20_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: 3_600,
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
  return Array.from({ length: 24 }, (_, index) =>
    driveAt(new Date(Date.UTC(2025 + Math.floor(index / 12), index % 12, 15, 12)).toISOString()));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/driving/seasonal-efficiency']}>
        <SeasonalEfficiencyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, rerenderPage: () => view.rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/driving/seasonal-efficiency']}>
        <SeasonalEfficiencyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  ) };
}

const sectionIds = [
  'seasonal-kpis',
  'seasonal-calendar-coverage',
  'seasonal-evidence-support',
  'seasonal-fitted-curve',
  'seasonal-month-profile',
  'seasonal-observation-timeline',
  'seasonal-deseasonalized-trend',
  'seasonal-residual-distribution',
  'seasonal-component-diagnostics',
  'seasonal-month-support',
  'seasonal-year-directory',
  'seasonal-ranked-months',
  'seasonal-accounting',
  'seasonal-methodology',
] as const;

function expectEveryShell() {
  for (const id of sectionIds) expect(screen.getByTestId(id)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  h.vehicleId = 7;
  h.timeZone = 'UTC';
  h.history = query({ data: readyHistory() });
  h.hiddenSeries = new Set();
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

afterEach(() => vi.restoreAllMocks());

describe('SeasonalEfficiencyPage', () => {
  it('renders all persistent analytical shells and exact capped query inputs', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Seasonal Efficiency' })).toBeInTheDocument();
    expectEveryShell();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the injected analysis clock across query changes', () => {
    const view = renderPage();
    expect(screen.getByText('Latest included: 16.5 days ago')).toBeInTheDocument();
    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 10 * 86_400_000);
    h.history = query({ data: readyHistory() });
    view.rerenderPage();
    expect(screen.getByText('Latest included: 16.5 days ago')).toBeInTheDocument();
  });

  it('keeps every shell visible during loading without a retry action', () => {
    h.history = query({ isLoading: true });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByLabelText('Loading seasonal efficiency history').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one actionable initial error while passive shells remain present', () => {
    h.history = query({ isError: true, error: new Error('history unavailable') });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps cached evidence visible with exactly one refresh retry', () => {
    h.history = query({
      data: readyHistory(),
      isError: true,
      error: new Error('refresh unavailable'),
    });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Latest included/)).toBeInTheDocument();
  });

  it('keeps all shells visible with no vehicle selected', () => {
    h.vehicleId = null;
    renderPage();
    expectEveryShell();
    expect(h.historyHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(screen.getAllByText('Select a vehicle above to make local seasonal evidence available.').length).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps all shells visible for empty returned history', () => {
    h.history = query({ data: [] });
    renderPage();
    expectEveryShell();
    expect(screen.getByText('No drives were returned for this vehicle.')).toBeInTheDocument();
    expect(within(screen.getByTestId('seasonal-accounting')).getByText(/0 returned/)).toBeInTheDocument();
  });

  it('discloses no qualified rows without hiding accounting', () => {
    h.history = query({ data: [driveAt('2026-01-01T12:00:00Z', { distanceM: 999 })] });
    renderPage();
    expectEveryShell();
    expect(screen.getByText('No returned rows met the completed-drive and Wh/m eligibility rules.')).toBeInTheDocument();
    expect(screen.getByText('Invalid / too-short distance')).toBeInTheDocument();
  });

  it('exposes the fit gate and thin evidence state without overclaiming', () => {
    h.history = query({ data: [driveAt('2026-08-01T12:00:00Z')] });
    renderPage();
    expectEveryShell();
    expect(screen.getByText('Insufficient samples')).toBeInTheDocument();
    expect(screen.getByText(/Evidence band: Thin/)).toBeInTheDocument();
  });

  it('warns when the latest returned 1,000-row window is capped', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, () => driveAt('2026-12-30T00:00:00Z')),
    });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByText('Latest returned 1,000-row window reached').length).toBeGreaterThan(0);
    expect(screen.getByText(/Exactly the latest 1,000-row return window/)).toBeInTheDocument();
  });

  it('uses the vehicle timezone and an explicit unit formatting boundary', () => {
    h.timeZone = 'America/Los_Angeles';
    h.history = query({ data: [driveAt('2026-01-01T00:30:00Z')] });
    renderPage();
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(screen.getAllByText('0.18 kWh / km').length).toBeGreaterThan(0);
    expect(screen.getByText(/Vehicle timezone: America\/Los_Angeles/)).toBeInTheDocument();
  });

  it('offers accessible chart summaries for a ready descriptive fit', () => {
    renderPage();
    for (const label of [
      'Fitted annual Wh per distance curve with a central residual band',
      'Observed and fitted intensity by vehicle-local calendar month',
      'Observed, fitted, and deseasonalized energy intensity over the vehicle-local observation timeline',
      'Deseasonalized energy intensity over the vehicle-local timeline',
      'Histogram of included distance share by fitted residual bin',
    ]) {
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    }
  });

  it('passes hidden legend state through to each targeted multi-series chart', () => {
    h.hiddenSeries = new Set(['observed', 'actual', 'samples', 'distance']);
    renderPage();
    for (const key of ['observed', 'actual', 'samples', 'distance']) {
      expect(screen.getAllByTestId(`seasonal-series-${key}`).every(
        (series) => series.getAttribute('data-hidden') === 'true',
      )).toBe(true);
    }
  });

  it('does not use predictive, causal, or score terminology in the page copy', () => {
    renderPage();
    expect(screen.queryByText(/forecast|prediction|accuracy|degradation|improvement|causal effect/i)).toBeNull();
    expect(screen.getByText(/in-sample descriptive fit/i)).toBeInTheDocument();
  });
});
