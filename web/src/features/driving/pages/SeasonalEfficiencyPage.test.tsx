import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-12-31T23:59:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'UTC',
  hiddenSeries: new Set<string>(),
  failedChart: null as string | null,
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

// Class-based shared boundaries use i18next directly, not useTranslation.
// Preserve the real module while supplying the same English fallback contract.
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      t: (key: string, fallback?: string | { defaultValue?: string }) =>
        typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
    },
  };
});

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

vi.mock('@/components/motion', async () => ({
  ...await vi.importActual<typeof import('@/components/motion')>('@/components/motion'),
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
    CHART_COLORS: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'],
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
    }) => {
      if (h.failedChart === title) throw new Error('Synthetic seasonal chart render failure');
      return (
      <figure role="img" aria-label={ariaLabel} data-chart-rows={data?.length ?? 0}>
        <figcaption>{title}</figcaption>
        {typeof children === 'function'
          ? children({ hiddenSeries: { isHidden: (key) => h.hiddenSeries.has(key) } })
          : children}
      </figure>
      );
    },
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
      <MemoryRouter initialEntries={['/seasonal-efficiency']}>
        <SeasonalEfficiencyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, rerenderPage: () => view.rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/seasonal-efficiency']}>
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
  h.failedChart = null;
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

afterEach(() => vi.restoreAllMocks());

describe('SeasonalEfficiencyPage', () => {

  it.each([
    ['365-day fitted intensity', 'seasonal-fitted-curve'],
    ['Twelve local calendar months', 'seasonal-month-profile'],
    ['Drive intensity over returned history', 'seasonal-observation-timeline'],
    ['Seasonally adjusted observed intensity', 'seasonal-deseasonalized-trend'],
    ['Distance share by residual bin', 'seasonal-residual-distribution'],
    ['Included samples and observed distance', 'seasonal-month-support'],
  ])('isolates a %s render failure and retries only that widget', (title, failedSection) => {
    // Keep all feature sections mounted; only the existing chart boundary fails.
    h.failedChart = title;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPage();
    for (const id of sectionIds) {
      if (id !== failedSection) expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId(failedSection)).toBeNull();
    expect(screen.getAllByText('Synthetic seasonal chart render failure')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    h.failedChart = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expectEveryShell();
    expect(screen.queryByText('Synthetic seasonal chart render failure')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('keeps unresolved history distinct from an authoritatively empty return', () => {
    h.history = query({ isSuccess: false });
    renderPage();
    expectEveryShell();
    expect(screen.getAllByLabelText('Loading seasonal efficiency history').length).toBeGreaterThan(1);
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Returned-history coverage has not resolved.', { contains: true });
    expect(screen.queryByText('No drives were returned for this vehicle.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('does not expose retained vehicle evidence after vehicle selection is cleared', () => {
    const view = renderPage();
    h.vehicleId = null;
    view.rerenderPage();
    expectEveryShell();
    expect(h.historyHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(screen.getAllByText('Select a vehicle above to make local seasonal evidence available.').length).toBeGreaterThan(1);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps every seasonal fit and accounting shell during a paused retained refresh', () => {
    h.history = { ...query({ data: readyHistory() }), fetchStatus: 'paused' };
    renderPage();
    expectEveryShell();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).not.toHaveTextContent(/offline/i);
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders all persistent analytical shells and exact capped query inputs', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Seasonal Efficiency' })).toBeInTheDocument();
    expectEveryShell();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the injected analysis clock across query changes', () => {
    const view = renderPage();
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Latest included: 16.50 days ago', { contains: true });
    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 10 * 86_400_000);
    h.history = query({ data: readyHistory() });
    view.rerenderPage();
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Latest included: 16.50 days ago', { contains: true });
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
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Latest included', { contains: true });
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
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Evidence band: Thin', { contains: true });
  });

  it('warns when the latest returned 1,000-row window is capped', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, () => driveAt('2026-12-30T00:00:00Z')),
    });
    renderPage();
    expectEveryShell();
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Latest returned 1,000-row window reached', { contains: true });
    expect(screen.getByText(/Exactly the latest 1,000-row return window/)).toBeInTheDocument();
  });

  it('uses the vehicle timezone and an explicit unit formatting boundary', () => {
    h.timeZone = 'America/Los_Angeles';
    h.history = query({ data: [driveAt('2026-01-01T00:30:00Z')] });
    renderPage();
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(screen.getAllByText('0.18 kWh / km').length).toBeGreaterThan(0);
    assertOperationalBriefDisclosure(screen.getByTestId('seasonal-kpis'), 'Vehicle timezone: America/Los_Angeles', { contains: true });
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
