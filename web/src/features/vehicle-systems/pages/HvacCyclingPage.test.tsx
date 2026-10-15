import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { ClimateState } from '@/types/vehicle-systems';
import { severityTokens, typography } from '@/lib/tokens';

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  request: vi.fn(),
}));
const refetch = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values =
        options && typeof options === 'object'
          ? (options as Record<string, unknown>)
          : {};
      return text.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_match, name: string) =>
          values[name] != null ? String(values[name]) : '',
      );
    },
    i18n: { language: 'en-US', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string, range?: { start?: string; end?: string }) => {
    h.historyHook(vehicleId, range);
    return h.history;
  },
}));

vi.mock('@/api/client', () => ({ request: h.request }));

vi.mock('@/hooks/useRangeState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useRangeState')>();
  return {
    ...actual,
    useRangeState: () => actual.useRangeState({ timezone: 'America/Los_Angeles' }),
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { duration: 'min' },
    formatDuration: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 60).toFixed(options?.precision ?? 1)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
}));

vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  EmbeddedChart: ({
    children,
    title,
    ariaLabel,
  }: {
    children: ReactNode | ((context: { hiddenSeries?: undefined }) => ReactNode);
    title: string;
    ariaLabel: string;
  }) => (
    <div>
      <h4>{title}</h4>
      <div role="img" aria-label={ariaLabel}>{typeof children === 'function' ? children({}) : children}</div>
    </div>
  ),
  ChartLegend: () => null,
  ChartTooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import HvacCyclingPage from './HvacCyclingPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
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
    isFetching: isLoading,
    isStale: false,
    fetchStatus: isLoading ? 'fetching' : 'idle',
    dataUpdatedAt: BASE,
    refetch,
    ...overrides,
  };
}

function climate(
  minute: number,
  state: Partial<ClimateState>,
): ClimateState {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    ...state,
  };
}

function completeEvidence(): ClimateState[] {
  return [
    climate(0, { hvacPower: false }),
    climate(5, { hvacPower: true }),
    climate(10, { hvacPower: true }),
    climate(15, { hvacPower: false }),
    climate(20, { hvacPower: false }),
    climate(25, { hvacPower: true }),
    climate(30, { hvacPower: true }),
    climate(35, { hvacPower: false }),
  ];
}

function renderPage(path = '/hvac-cycling') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HvacCyclingPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'hvac-cycling-kpis',
  'hvac-cycling-source-availability',
  'hvac-cycling-coverage-cadence',
  'hvac-cycling-interval-disposition',
  'hvac-cycling-duty-composition',
  'hvac-cycling-hourly-duty',
  'hvac-cycling-transition-matrix',
  'hvac-cycling-run-distribution',
  'hvac-cycling-cycle-diagnostics',
  'hvac-cycling-thresholds',
  'hvac-cycling-run-directory',
  'hvac-cycling-accounting',
  'hvac-cycling-availability',
  'hvac-cycling-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

function evidenceMetric(label: string): HTMLElement {
  const metric = within(screen.getByTestId('hvac-cycling-kpis'))
    .getAllByRole('listitem')
    .find(item => within(item).queryByText(label) !== null);
  if (!metric) {
    throw new Error(`Missing evidence metric: ${label}`);
  }
  return metric;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.history = query({ data: completeEvidence() });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HvacCyclingPage', () => {
  it.each([
    ['2026-03-08', '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z'],
    ['2026-11-01', '2026-11-01T07:00:00.000Z', '2026-11-02T08:00:00.000Z'],
  ])('passes the exact custom local-day bounds across DST for %s', (date, start, end) => {
    renderPage(`/hvac-cycling?from=${date}&to=${date}&time_scope=custom`);
    expect(h.historyHook).toHaveBeenLastCalledWith('7', { start, end });
    expectEverySection();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /date range/i })).not.toBeInTheDocument();
  });

  it('passes rolling 24-hour instants and refreshes both exact bounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T22:12:42.288Z'));
    renderPage('/hvac-cycling?time_scope=24h');
    expect(h.historyHook).toHaveBeenLastCalledWith('7', {
      start: '2026-10-13T22:12:42.288Z',
      end: '2026-10-14T22:12:42.288Z',
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(h.historyHook).toHaveBeenLastCalledWith('7', {
      start: '2026-10-13T22:13:42.288Z',
      end: '2026-10-14T22:13:42.288Z',
    });
  });

  it('scopes full climate results and query keys to both bounds and vehicle, preserving unbounded callers', async () => {
    const { useClimateHistory, vehicleSystemsKeys } = await vi.importActual<
      typeof import('@/api/hooks/useVehicleSystems')
    >('@/api/hooks/useVehicleSystems');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const start = '2026-03-08T08:00:00.000Z';
    const end = '2026-03-09T07:00:00.000Z';
    const rows = Array.from({ length: 600 }, (_, minute) => climate(minute, { hvacPower: true }));
    h.request.mockResolvedValue(rows);
    const { result, rerender, unmount } = renderHook(
      ({ vehicleId, range }: { vehicleId: string; range?: { start: string; end: string } }) =>
        useClimateHistory(vehicleId, range),
      { wrapper, initialProps: { vehicleId: '', range: { start, end } } },
    );
    expect(h.request).not.toHaveBeenCalled();
    rerender({ vehicleId: '7', range: { start, end } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
    const [path, options] = h.request.mock.calls[0]!;
    const url = new URL(path, 'http://localhost');
    expect(url.pathname).toBe('/climate');
    expect(Object.fromEntries(url.searchParams)).toEqual({ vehicle_id: '7', start, end });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(client.getQueryData(vehicleSystemsKeys.climateHistory('7', start, end))).toEqual(rows);

    const nextEnd = '2026-03-10T07:00:00.000Z';
    rerender({ vehicleId: '7', range: { start, end: nextEnd } });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(vehicleSystemsKeys.climateHistory('7', start, nextEnd))).toBeDefined();
    expect(new URL(h.request.mock.calls[1]![0], 'http://localhost').searchParams.get('end')).toBe(nextEnd);
    const nextStart = '2026-03-09T07:00:00.000Z';
    rerender({ vehicleId: '7', range: { start: nextStart, end: nextEnd } });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(3));
    expect(client.getQueryState(vehicleSystemsKeys.climateHistory('7', nextStart, nextEnd))).toBeDefined();
    expect(new URL(h.request.mock.calls[2]![0], 'http://localhost').searchParams.get('start')).toBe(nextStart);
    rerender({ vehicleId: '8', range: { start: nextStart, end: nextEnd } });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(4));
    expect(client.getQueryState(vehicleSystemsKeys.climateHistory('8', nextStart, nextEnd))).toBeDefined();
    expect(new URL(h.request.mock.calls[3]![0], 'http://localhost').searchParams.get('vehicle_id')).toBe('8');
    h.request.mockResolvedValue(null);
    rerender({ vehicleId: '7', range: undefined });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(h.request.mock.calls[4]![0]).toBe('/climate?vehicle_id=7');
    expect(vehicleSystemsKeys.climateHistory('7')).toEqual(['climate', 'history', '7']);
    unmount();
    client.clear();
  });

  it('aborts the climate request when its range changes or the caller unmounts', async () => {
    const { useClimateHistory } = await vi.importActual<
      typeof import('@/api/hooks/useVehicleSystems')
    >('@/api/hooks/useVehicleSystems');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    h.request.mockImplementation(() => new Promise<ClimateState[]>(() => {}));
    const { rerender, unmount } = renderHook(
      ({ end }: { end: string }) => useClimateHistory('7', {
        start: '2026-03-08T08:00:00.000Z', end,
      }),
      { wrapper, initialProps: { end: '2026-03-09T07:00:00.000Z' } },
    );
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    const firstSignal: AbortSignal = h.request.mock.calls[0]![1].signal;
    rerender({ end: '2026-03-10T07:00:00.000Z' });
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    const secondSignal: AbortSignal = h.request.mock.calls[1]![1].signal;
    unmount();
    expect(secondSignal.aborted).toBe(true);
    client.clear();
    h.request.mockReset();
  });

  it.each([
    ['complete non-short runs', [
      climate(0, { hvacPower: false }),
      climate(1, { hvacPower: true }),
      climate(6, { hvacPower: true }),
      climate(11, { hvacPower: true }),
      climate(16, { hvacPower: false }),
    ]],
    ['empty evidence', []],
    ['censored active run', [
      climate(0, { hvacPower: true }),
      climate(1, { hvacPower: false }),
    ]],
  ])('keeps all six evidence icons muted for %s', (_name, data) => {
    h.history = query({ data });
    renderPage();

    const metrics = within(screen.getByTestId('hvac-cycling-kpis')).getAllByRole('listitem');
    expect(metrics).toHaveLength(6);
    const icons = ['database', 'activity', 'binary', 'clock3', 'gauge', 'rotate-cw'];
    metrics.forEach((metric, index) => {
      const icon = metric.querySelector('svg');
      expect(icon).toHaveClass(`lucide-${icons[index]}`, typography.color.muted);
      expect(icon).not.toHaveClass(severityTokens.warn.fg);
    });
  });

  it('uses warning ink only for qualified short-cycle evidence', () => {
    h.history = query({ data: [
      climate(0, { hvacPower: false }),
      climate(1, { hvacPower: true }),
      climate(2, { hvacPower: false }),
    ] });
    renderPage();

    const metrics = within(screen.getByTestId('hvac-cycling-kpis')).getAllByRole('listitem');
    expect(metrics).toHaveLength(6);
    metrics.slice(0, 5).forEach(metric => {
      expect(metric.querySelector('svg')).toHaveClass(typography.color.muted);
    });
    const rate = evidenceMetric('Qualified short-cycle rate');
    expect(rate.querySelector('svg')).toHaveClass('lucide-rotate-cw', severityTokens.warn.fg);
    expect(rate.querySelector('svg')).not.toHaveClass(typography.color.muted);
    expect(within(rate).getByText(/^100(?:\.0+)?%$/)).toBeInTheDocument();
  });

  it.each([
    ['active loading', { isLoading: true, isSuccess: false }],
    ['paused without data', { isSuccess: false, fetchStatus: 'paused' }],
    ['unresolved idle', { isSuccess: false }],
    ['initial failure', {
      isSuccess: false,
      isError: true,
      error: new Error('history unavailable'),
    }],
  ] satisfies [string, Partial<QueryStub>][])(
    'withholds directory counts during %s without changing the cap or shell',
    (_name, overrides) => {
      h.history = query(overrides);
      renderPage();

      expectEverySection();
      const directory = within(screen.getByTestId('hvac-cycling-run-directory'));
      expect(directory.getByText('Showing Unknown of Unknown runs; Unknown omitted by the 50-run display cap.'))
        .toBeInTheDocument();
      expect(directory.queryByRole('list')).not.toBeInTheDocument();
      expect(directory.queryByText(
        'No climate rows were returned for this vehicle.',
      )).not.toBeInTheDocument();
    },
  );

  it.each([
    ['empty response', []],
    ['known sample without an interval', [climate(0, { hvacPower: false })]],
  ])('publishes genuine zero directory counts for a successful %s', (_name, data) => {
    h.history = query({ data });
    renderPage();

    const directory = within(screen.getByTestId('hvac-cycling-run-directory'));
    expect(directory.getByText(
      'Showing 0 of 0 runs; 0 omitted by the 50-run display cap.',
    )).toBeInTheDocument();
    expect(directory.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each([
    ['failed refresh', {
      isSuccess: false,
      isError: true,
      error: new Error('refresh unavailable'),
    }],
    ['paused refresh', { isSuccess: false, fetchStatus: 'paused' }],
  ] satisfies [string, Partial<QueryStub>][])(
    'retains successful empty directory counts during a %s',
    (_name, overrides) => {
      h.history = query({ data: [], ...overrides });
      renderPage();

      const directory = within(screen.getByTestId('hvac-cycling-run-directory'));
      expect(directory.getByText(
        'Showing 0 of 0 runs; 0 omitted by the 50-run display cap.',
      )).toBeInTheDocument();
      expect(directory.getByText(
        'No climate rows were returned for this vehicle.',
      )).toBeInTheDocument();
      expectEverySection();
    },
  );

  it('retains directory counts and every run detail through refresh failure and recovery', () => {
    const data = completeEvidence();
    h.history = query({ data });
    const page = renderPage();
    const directory = () => within(screen.getByTestId('hvac-cycling-run-directory'));
    const count = 'Showing 4 of 4 runs; 0 omitted by the 50-run display cap.';
    const runs = directory().getAllByRole('listitem').map(run => run.textContent);
    expect(runs).toHaveLength(4);
    expect(directory().getByText(count)).toBeInTheDocument();

    h.history = query({
      data,
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    page.rerender(<MemoryRouter><HvacCyclingPage /></MemoryRouter>);
    expect(directory().getByText(count)).toBeInTheDocument();
    expect(directory().getAllByRole('listitem').map(run => run.textContent)).toEqual(runs);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    h.history = query({ data, isFetching: true, fetchStatus: 'fetching' });
    page.rerender(<MemoryRouter><HvacCyclingPage /></MemoryRouter>);
    expect(directory().getByText(count)).toBeInTheDocument();
    expect(directory().getAllByRole('listitem').map(run => run.textContent)).toEqual(runs);

    h.history = query({ data: [] });
    page.rerender(<MemoryRouter><HvacCyclingPage /></MemoryRouter>);
    expect(directory().getByText(
      'Showing 0 of 0 runs; 0 omitted by the 50-run display cap.',
    )).toBeInTheDocument();
    expect(directory().getByText(
      'No climate rows were returned for this vehicle.',
    )).toBeInTheDocument();
    expect(directory().queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expectEverySection();
  });

  it('renders all fourteen persistent shells with complete evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'HVAC cycling',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', {
      start: expect.any(String),
      end: expect.any(String),
    });
    expect(screen.getByText('2-run denominator')).toBeInTheDocument();
    expect(screen.getAllByText('Complete support').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Hourly HVAC duty' })).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: 'Bar chart of HVAC duty by local hour with observed-time support in the data table',
    })).toBeInTheDocument();
    expect(within(evidenceMetric('Observed duration')).getByText('35.0 min')).toBeInTheDocument();
  });

  it('keeps the header and every shell without a vehicle or duplicate control', () => {
    h.vehicleId = null;
    h.history = query();
    renderPage();

    expectEverySection();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(h.historyHook).toHaveBeenLastCalledWith('', {
      start: expect.any(String),
      end: expect.any(String),
    });
    expect(within(screen.getByTestId('hvac-cycling-run-directory')).getByText(
      'Showing Unknown of Unknown runs; Unknown omitted by the 50-run display cap.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Select a vehicle to analyze its returned climate timeline.',
    )).toBeInTheDocument();
  });

  it('keeps every shell visible while loading', () => {
    h.history = query({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading HVAC cycling evidence',
    })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one retry for an initial error while retaining all shells', () => {
    h.history = query({
      isError: true,
      isSuccess: false,
      error: new Error('history unavailable'),
    });
    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves cached evidence through a refresh error', () => {
    h.history = query({
      data: completeEvidence(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Climate history could not refresh. Showing the most recently loaded HVAC evidence.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Complete support').length).toBeGreaterThan(0);
    expect(within(evidenceMetric('Observed duration')).getByText('35.0 min')).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps exact zero accounting for an empty success', () => {
    h.history = query({ data: [] });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'The climate endpoint returned no rows, so no cycling claim is made.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('hvac-cycling-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(4);
  });

  it('discloses returned but uninterpretable rows', () => {
    h.history = query({
      data: [
        climate(0, {}),
        climate(5, { fanSpeed: Number.NaN }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Rows were returned, but every unique timestamp had an uninterpretable HVAC state.',
    )).toBeInTheDocument();
    expect(screen.getByText('Valid timestamp, unknown state')).toBeInTheDocument();
  });

  it('distinguishes known samples from absent observed intervals', () => {
    h.history = query({
      data: [climate(0, { hvacPower: false })],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Known states exist, but no adjacent interval passed the continuity and maximum-gap rules.',
    )).toBeInTheDocument();
    expect(screen.getByText('0-run denominator')).toBeInTheDocument();
  });

  it('withholds short-cycle rate for censored-only active evidence', () => {
    h.history = query({
      data: [
        climate(0, { hvacPower: true }),
        climate(5, { hvacPower: true }),
        climate(10, { hvacPower: false }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Active run fragments are present, but none has two observed transition boundaries; short-cycle rate is withheld.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'The denominator is zero: every active fragment is left-censored, right-censored, or both. No short-cycle rate is published.',
    )).toBeInTheDocument();
    expect(within(evidenceMetric('Qualified short-cycle rate')).getByText('—')).toBeInTheDocument();
    expect(evidenceMetric('Qualified short-cycle rate')).toHaveAttribute('data-value-state', 'missing');
  });
});
