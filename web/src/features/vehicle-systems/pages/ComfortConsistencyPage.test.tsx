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

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  temperature: '°C' as '°C' | '°F',
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
    unitPrefs: {
      temperature: h.temperature,
      duration: 'min',
      locale: 'en-US',
      precision: 1,
    },
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
    children: ReactNode;
    title: string;
    ariaLabel: string;
  }) => (
    <div>
      <h4>{title}</h4>
      <div role="img" aria-label={ariaLabel}>{children}</div>
    </div>
  ),
  ChartTooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import ComfortConsistencyPage from './ComfortConsistencyPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isStale: boolean;
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
    fetchStatus: isLoading ? 'fetching' : 'idle',
    isStale: false,
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
    climate(0, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
    climate(5, {
      insideTemp: 30,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(10, {
      insideTemp: 25,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(15, {
      insideTemp: 21.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(20, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(25, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
    climate(30, {
      insideTemp: 15,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(35, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(40, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(45, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
  ];
}

function renderPage(path = '/comfort-consistency') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ComfortConsistencyPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'comfort-consistency-kpis',
  'comfort-consistency-source-availability',
  'comfort-consistency-coverage-cadence',
  'comfort-consistency-row-disposition',
  'comfort-consistency-interval-composition',
  'comfort-consistency-hourly-profile',
  'comfort-consistency-deviation-distribution',
  'comfort-consistency-setpoint-agreement',
  'comfort-consistency-stabilization-outcomes',
  'comfort-consistency-score-decomposition',
  'comfort-consistency-thresholds',
  'comfort-consistency-window-directory',
  'comfort-consistency-accounting',
  'comfort-consistency-availability',
  'comfort-consistency-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.temperature = '°C';
  h.history = query({ data: completeEvidence() });
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ComfortConsistencyPage', () => {
  it('threads custom local dates across DST with the exact next-midnight upper bound', () => {
    renderPage('/comfort-consistency?from=2026-03-08&to=2026-03-08&time_scope=custom');
    expect(h.historyHook).toHaveBeenLastCalledWith('7', {
      start: '2026-03-08T08:00:00.000Z',
      end: '2026-03-09T07:00:00.000Z',
    });
    expectEverySection();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /date range/i })).not.toBeInTheDocument();
  });

  it('threads precise rolling 24-hour instants rather than calendar dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T22:12:42.288Z'));
    renderPage('/comfort-consistency?time_scope=24h');
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

  it('renders all fifteen persistent shells with complete evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Comfort consistency',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', {
      start: expect.any(String),
      end: expect.any(String),
    });
    expect(screen.getAllByText('Sustained band observed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Balances')).toHaveLength(7);
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
    expect(screen.getByText(
      'Select a vehicle to analyze its returned climate timeline.',
    )).toBeInTheDocument();
  });

  describe('comfort consistency climate history transport', () => {
    it('keys and sends both bounds unchanged, preserves cancellation, enablement and safeArray', async () => {
      const { useClimateHistory, vehicleSystemsKeys } = await vi.importActual<
        typeof import('@/api/hooks/useVehicleSystems')
      >('@/api/hooks/useVehicleSystems');
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const start = '2026-03-08T08:00:00.000Z';
      const end = '2026-03-09T07:00:00.000Z';
      h.request.mockResolvedValue(null);
      const { result, rerender, unmount } = renderHook(
        ({ vehicleId, range }: { vehicleId: string; range?: { start: string; end: string } }) =>
          useClimateHistory(vehicleId, range),
        { wrapper, initialProps: { vehicleId: '', range: { start, end } } },
      );
      expect(h.request).not.toHaveBeenCalled();
      rerender({ vehicleId: '7', range: { start, end } });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
      const [path, options] = h.request.mock.calls[0]!;
      const url = new URL(path, 'http://localhost');
      expect(url.pathname).toBe('/climate');
      expect(Object.fromEntries(url.searchParams)).toEqual({ vehicle_id: '7', start, end });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(client.getQueryData(vehicleSystemsKeys.climateHistory('7', start, end))).toBeNull();

      const nextEnd = '2026-03-10T07:00:00.000Z';
      rerender({ vehicleId: '7', range: { start, end: nextEnd } });
      await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
      expect(new URL(h.request.mock.calls[1]![0], 'http://localhost').searchParams.get('end')).toBe(nextEnd);
      const nextStart = '2026-03-09T07:00:00.000Z';
      rerender({ vehicleId: '7', range: { start: nextStart, end: nextEnd } });
      await waitFor(() => expect(h.request).toHaveBeenCalledTimes(3));
      expect(new URL(h.request.mock.calls[2]![0], 'http://localhost').searchParams.get('start')).toBe(nextStart);
      rerender({ vehicleId: '7', range: undefined });
      await waitFor(() => expect(h.request).toHaveBeenCalledTimes(4));
      expect(h.request.mock.calls[3]![0]).toBe('/climate?vehicle_id=7');
      expect(vehicleSystemsKeys.climateHistory('7')).toEqual(['climate', 'history', '7']);
      unmount();
      client.clear();
    });
  });

  it('keeps every shell visible while loading', () => {
    h.history = query({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading comfort-consistency evidence',
    })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps deferred history unresolved until a real empty response arrives', () => {
    h.history = query({ isLoading: false, isSuccess: false });
    const { rerender } = renderPage();

    expectEverySection();
    expect(screen.queryByText(
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).not.toBeInTheDocument();
    expect(screen.getAllByText(
      'Climate-history availability has not resolved.',
    ).length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .queryAllByText('Balances'),
    ).toHaveLength(0);

    h.history = query({ data: [] });
    rerender(
      <MemoryRouter initialEntries={['/comfort-consistency']}>
        <ComfortConsistencyPage />
      </MemoryRouter>,
    );

    expectEverySection();
    expect(screen.getByText(
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(7);
  });

  it('keeps paused initial history unresolved without an empty-response claim', () => {
    h.history = query({
      isSuccess: false,
      fetchStatus: 'paused',
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByText(
      'Climate history loading is paused while the network is unavailable; no empty response is inferred.',
    ).length).toBeGreaterThan(0);
    expect(screen.queryByText(
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .queryAllByText('Balances'),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retains observed comfort evidence while its refresh is paused', () => {
    h.history = query({
      data: completeEvidence(),
      isSuccess: false,
      fetchStatus: 'paused',
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Previously loaded data remains visible while affected sources recover. Climate history loading is paused while the network is unavailable; no empty response is inferred.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Sustained band observed').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(7);
    expect(screen.queryByText(
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).not.toBeInTheDocument();
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
      'Climate history could not refresh. Showing the most recently loaded comfort evidence.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Sustained band observed').length).toBeGreaterThan(0);
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
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(7);
  });

  it('discloses timestamped rows that fail the analysis gates', () => {
    h.history = query({
      data: [
        climate(0, {}),
        climate(5, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: false,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Timestamped rows exist, but none passed the active-HVAC, cabin, and setpoint gates.',
    )).toBeInTheDocument();
    expect(screen.getByText('Unknown HVAC state')).toBeInTheDocument();
  });

  it('distinguishes sample evidence from absent duration support', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Sample metrics are available, but no adjacent interval supports duration-weighted consistency.',
    )).toBeInTheDocument();
  });

  it('keeps in-band active fragments separate from stabilization windows', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
        climate(5, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Active fragments exist, but none began outside the configured comfort band.',
    )).toBeInTheDocument();
  });

  it('discloses censored outside-band fragments without claiming stabilization', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 30,
          driverTempSetting: 21,
          hvacPower: true,
        }),
        climate(5, {
          insideTemp: 28,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Outside-band fragments were observed, but none reached the sustained-band gate; censored endings remain disclosed.',
    )).toBeInTheDocument();
    expect(screen.getByText('Right-censored')).toBeInTheDocument();
  });

  it('converts Celsius deltas to the selected Fahrenheit display unit', () => {
    h.temperature = '°F';
    renderPage();

    expect(screen.getByText('+/- 2.7 °F')).toBeInTheDocument();
  });
});
