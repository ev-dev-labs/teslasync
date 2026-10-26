import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import i18n from 'i18next';
import english from '@/i18n/en.json';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { SleepEfficiencyData } from '@/types/energy';
import { deriveDataState } from '@/api/dataState';
import type { AppSettings } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: unknown, options?: unknown) => {
      if (typeof fallbackOrOptions === 'string') {
        const values =
          options && typeof options === 'object'
            ? (options as Record<string, unknown>)
            : {};
        return fallbackOrOptions.replace(
          /{{(\w+)}}/g,
          (_match: string, name: string) =>
            name in values ? String(values[name]) : `{{${name}}}`,
        );
      }
      if (
        fallbackOrOptions
        && typeof fallbackOrOptions === 'object'
        && 'defaultValue' in fallbackOrOptions
      ) {
        return String(
          (fallbackOrOptions as { defaultValue?: unknown }).defaultValue
            ?? key,
        );
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const unitState = vi.hoisted(() => ({ fahrenheit: false }));
const dateSettings = vi.hoisted(() => ({
  locale: 'en-US', tz_display_default: 'user', timezone_user: 'UTC', decimal_precision: 2,
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ locale: dateSettings.locale, settings: dateSettings, settingsUnavailable: false }),
}));
const widgetState = vi.hoisted(() => ({ failDestination: false }));
const chartPreference = vi.hoisted(() => ({ palette: 'cb_safe' }));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isLoading: false, isFetching: false, isError: false }),
  useCreateAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useChartPalette', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useChartPalette')>();
  return {
    ...actual,
    useChartPalette: () => actual.resolveChartPalette(chartPreference.palette),
  };
});

// Keep the real frame/legend state while making series observable without layout.
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    BarChart: ({ children, data }: { children?: ReactNode; data?: unknown }) =>
      <div data-testid="sleep-chart-bars" data-rows={JSON.stringify(data)}>{children}</div>,
    Bar: ({ dataKey, fill, hide, yAxisId }: {
      dataKey: string; fill?: string; hide?: boolean; yAxisId?: string;
    }) => <div data-testid={`sleep-series-${dataKey}`} data-fill={fill} data-hidden={String(hide)} data-axis={yAxisId} />,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ChartLegend: () => null,
    chartGrid: null,
  };
});
const pricingFixture = vi.hoisted(() => ({
  symbol: '$' as string | null | undefined,
  available: true,
  error: null as Error | null,
  paused: false,
  retry: vi.fn(),
}));

vi.mock('../components/sleep-efficiency', async (importActual) => {
  const actual = await importActual<typeof import('../components/sleep-efficiency')>();
  const Destination = actual.TransitionDestinationChart;
  return {
    ...actual,
    TransitionDestinationChart: (props: ComponentProps<typeof Destination>) => {
      if (widgetState.failDestination) throw new Error('Synthetic transition widget failure');
      return <Destination {...props} />;
    },
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: unitState.fahrenheit ? '°F' : '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 2,
    },
    formatDistance: (value: number | null | undefined) => String(value),
    formatSpeed: (value: number | null | undefined) => String(value),
    formatTemperature: (value: number | null | undefined) => {
      if (value == null) return '—';
      const converted = unitState.fahrenheit ? value * 1.8 + 32 : value;
      return `${converted.toFixed(2)} ${unitState.fahrenheit ? '°F' : '°C'}`;
    },
    formatPressure: (value: number | null | undefined) => String(value),
    formatEnergy: (value: number | null | undefined) =>
      value == null ? '—' : `${(value / 1_000).toFixed(2)} kWh`,
    formatDuration: (value: number | null | undefined) => String(value),
    formatPower: (value: number | null | undefined) => String(value),
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    pricingState: deriveDataState({
      data: pricingFixture.available
        ? { currency_symbol: pricingFixture.symbol } as AppSettings
        : undefined,
      isError: pricingFixture.error != null,
      error: pricingFixture.error,
      fetchStatus: pricingFixture.paused ? 'paused' : 'idle',
      refetch: pricingFixture.retry,
    }),
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: (value: number) => `$${value.toFixed(2)}`,
    formatCurrency: (value: number) => `${pricingFixture.symbol}${value.toFixed(2)}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual =
    await importActual<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useSleepEfficiency: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual =
    await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import SleepEfficiencyPage from './SleepEfficiencyPage';
import { resolveChartPalette } from '@/hooks/useChartPalette';

it('offers keyboard-accessible transition interpretation help without duration evidence', () => {
  mockSleep.mockReturnValue(queryResult({ data: transitionOnlyData() }));
  renderPage();
  const help = screen.getByRole('button', { name: 'Methodology and interpretation limits' });
  help.focus();
  expect(help).toHaveFocus();
  expect(help).toHaveAccessibleDescription(english.sleep.methodology.transitionSemantics);
});

type SleepQueryResult = ReturnType<typeof useSleepEfficiency>;

const mockSleep = vi.mocked(useSleepEfficiency);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

function queryResult(
  overrides: Partial<{
    data: SleepEfficiencyData | undefined;
    isLoading: boolean;
    isPending: boolean;
    isFetching: boolean;
    isError: boolean;
    isSuccess: boolean;
    dataUpdatedAt: number;
    fetchStatus: 'fetching' | 'paused' | 'idle';
    error: Error | null;
    refetch: ReturnType<typeof vi.fn>;
  }> = {},
): SleepQueryResult {
  const value = {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: true,
    isPending: false,
    isStale: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
  return value as unknown as SleepQueryResult;
}

function transitionOnlyData(
  overrides: Partial<SleepEfficiencyData> = {},
): SleepEfficiencyData {
  return {
    vehicle_id: 1,
    period_days: 30,
    state_distribution: [
      { state: 'asleep', count: 8, total_minutes: 0 },
      { state: 'online', count: 2, total_minutes: 0 },
    ],
    sleep_efficiency_pct: 0,
    time_to_sleep_avg_min: 0,
    sentry_comparison: [],
    sentry_on_drain_rate: 0,
    sentry_off_drain_rate: 0,
    sentry_monthly_kwh: 0,
    sentry_monthly_cost: 0,
    sentry_extra_drain_rate: 0,
    sentry_extra_monthly_kwh: 0,
    sentry_extra_monthly_cost: 0,
    battery_capacity_wh: 75_000,
    capacity_source: 'default',
    base_cost_per_kwh: 0.12,
    recent_events: [],
    total_events: 0,
    avg_sentry_duration_hours: 0,
    ...overrides,
  };
}

function fullyPopulatedData(): SleepEfficiencyData {
  return transitionOnlyData({
    sleep_efficiency_pct: 75,
    time_to_sleep_avg_min: 12,
    state_distribution: [
      { state: 'asleep', count: 8, total_minutes: 90 },
      { state: 'online', count: 2, total_minutes: 30 },
      { state: 'mystery', count: 1, total_minutes: 0 },
    ],
    sentry_comparison: [
      {
        sentry_mode: true,
        count: 4,
        avg_drain_rate: 0.1,
        avg_duration_hours: 5,
        avg_battery_lost: 4,
        avg_temp: 15,
      },
      {
        sentry_mode: false,
        count: 5,
        avg_drain_rate: 0.025,
        avg_duration_hours: 6,
        avg_battery_lost: 1,
        avg_temp: 14,
      },
    ],
    recent_events: [
      {
        id: 10,
        start_date: '2026-07-16T01:00:00Z',
        end_date: '2026-07-16T05:00:00Z',
        duration_hours: 4,
        battery_lost: 2,
        drain_rate: 0.5,
        sentry_mode: false,
        outside_temp: 20,
        start_battery: 80,
        end_battery: 78,
      },
    ],
    total_events: 1,
    avg_sentry_duration_hours: 5,
  });
}

function selectVehicle(vehicleId: number | null) {
  mockSelectedVehicle.mockReturnValue({
    vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  });
}

function HeaderRangeControl() {
  const [, setParams] = useSearchParams();
  return <Button type="button" data-testid="header-sleep-range" onClick={() => setParams((params) => {
    const next = new URLSearchParams(params);
    next.set('from', '2026-07-16');
    next.set('to', '2026-07-16');
    return next;
  })}>Select one day in header</Button>;
}

function renderPage(
  entries: string[] = [
    '/sleep-efficiency?from=2026-06-17&to=2026-07-16',
  ],
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const page = () => (
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SleepEfficiencyPage />
          <HeaderRangeControl />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(page());
  return { ...rendered, rerenderPage: () => rendered.rerender(page()) };
}

const SECTION_TEST_IDS = [
  'sleep-efficiency-kpi-evidence',
  'sleep-efficiency-transition-distribution',
  'sleep-efficiency-transition-composition',
  'sleep-efficiency-dwell-distribution',
  'sleep-efficiency-diagnostics',
  'sleep-efficiency-transition-diversity',
  'sleep-efficiency-state-directory',
  'sleep-efficiency-sentry-comparison',
  'sleep-efficiency-sentry-projection',
  'sleep-efficiency-event-profile',
  'sleep-efficiency-event-directory',
  'sleep-efficiency-availability-matrix',
  'sleep-efficiency-range-source-coverage',
  'sleep-efficiency-methodology',
] as const;

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: english } },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.fahrenheit = false;
  dateSettings.locale = 'en-US';
  dateSettings.timezone_user = 'UTC';
  widgetState.failDestination = false;
  chartPreference.palette = 'cb_safe';
  pricingFixture.symbol = '$';
  pricingFixture.available = true;
  pricingFixture.error = null;
  pricingFixture.paused = false;
  vi.spyOn(Date, 'now').mockReturnValue(
    Date.parse('2026-08-08T12:00:00Z'),
  );
  selectVehicle(1);
  mockSleep.mockReturnValue(
    queryResult({ data: transitionOnlyData(), isSuccess: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SleepEfficiencyPage persistent workspace', () => {
  it('updates restrained palette presentation without resetting saved IDs, hidden keys, or raw series', () => {
    const data = fullyPopulatedData();
    mockSleep.mockReturnValue(queryResult({ data }));
    const original = structuredClone(data);
    const { rerenderPage } = renderPage([
      '/sleep-efficiency?from=2026-06-17&to=2026-07-16&hidden_sleep-efficiency-sentry-comparison=drainRate',
    ]);
    const dwell = within(screen.getByTestId('sleep-efficiency-dwell-distribution'));
    const sentry = within(screen.getByTestId('sleep-efficiency-sentry-comparison'));
    const dwellRows = dwell.getByTestId('sleep-chart-bars').getAttribute('data-rows');
    const sentryRows = sentry.getByTestId('sleep-chart-bars').getAttribute('data-rows');
    expect(JSON.parse(dwellRows ?? '[]')).toEqual([
      { state: 'Asleep', minutes: 90, share: 75 },
      { state: 'Online', minutes: 30, share: 25 },
      { state: 'mystery', minutes: 0, share: 0 },
    ]);
    expect(JSON.parse(sentryRows ?? '[]')).toEqual([
      { mode: 'Sentry on', count: 4, drainRate: 0.1, batteryLost: 4, durationHours: 5 },
      { mode: 'Sentry off', count: 5, drainRate: 0.025, batteryLost: 1, durationHours: 6 },
    ]);
    for (const savedId of ['cb_safe', 'neon', 'cb_safe']) {
      chartPreference.palette = savedId;
      rerenderPage();
      const palette = resolveChartPalette(savedId);
      expect(chartPreference.palette).toBe(savedId);
      expect(dwell.getByTestId('sleep-series-minutes')).toHaveAttribute('data-fill', palette[3]);
      expect(sentry.getByTestId('sleep-series-drainRate')).toHaveAttribute('data-fill', palette[2]);
      expect(sentry.getByTestId('sleep-series-batteryLost')).toHaveAttribute('data-fill', palette[3]);
      expect(sentry.getByTestId('sleep-series-drainRate')).toHaveAttribute('data-hidden', 'true');
      expect(sentry.getByTestId('sleep-series-batteryLost')).toHaveAttribute('data-hidden', 'false');
      expect(sentry.getByTestId('sleep-series-drainRate')).toHaveAttribute('data-axis', 'rate');
      expect(sentry.getByTestId('sleep-series-batteryLost')).toHaveAttribute('data-axis', 'dose');
      expect(dwell.getByTestId('sleep-chart-bars')).toHaveAttribute('data-rows', dwellRows);
      expect(sentry.getByTestId('sleep-chart-bars')).toHaveAttribute('data-rows', sentryRows);
      expect(data).toEqual(original);
    }
  });

  it.each([undefined, null, '', '   '])('withholds missing currency identity (%s) without erasing numeric context', (symbol) => {
    pricingFixture.symbol = symbol;
    mockSleep.mockReturnValue(queryResult({ data: fullyPopulatedData() }));
    renderPage();
    const projection = within(screen.getByTestId('sleep-efficiency-sentry-projection'));
    expect(projection.getByText('0.12 (Currency: Unavailable)/kWh')).toBeInTheDocument();
    expect(projection.getByText('6.57 (Currency: Unavailable)')).toBeInTheDocument();
    expect(projection.getByText('54.75 kWh')).toBeInTheDocument();
    expect(screen.queryByText('$6.57')).not.toBeInTheDocument();
  });

  it.each(['loading', 'failed', 'paused'])('does not use default currency when settings are %s', (status) => {
    pricingFixture.available = false;
    pricingFixture.error = status === 'failed' ? new Error('settings failed') : null;
    pricingFixture.paused = status === 'paused';
    mockSleep.mockReturnValue(queryResult({ data: fullyPopulatedData() }));
    renderPage();
    expect(screen.getByText('6.57 (Currency: Unavailable)')).toBeInTheDocument();
    expect(screen.getByText('4 on · 5 off')).toBeInTheDocument();
    expect(screen.queryByText('$6.57')).not.toBeInTheDocument();
  });

  it.each(['failed', 'paused'])('retains the saved currency and discloses %s settings independently', (status) => {
    pricingFixture.symbol = '€';
    pricingFixture.error = status === 'failed' ? new Error('settings refresh failed') : null;
    pricingFixture.paused = status === 'paused';
    mockSleep.mockReturnValue(queryResult({ data: fullyPopulatedData() }));
    renderPage();
    expect(screen.getByText('€6.57')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Settings may be out of date');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(pricingFixture.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, -0.12])('keeps invalid or missing sleep price (%s) distinct from zero', (price) => {
    const data = fullyPopulatedData();
    data.base_cost_per_kwh = price;
    mockSleep.mockReturnValue(queryResult({ data }));
    renderPage();
    const projection = within(screen.getByTestId('sleep-efficiency-sentry-projection'));
    expect(projection.queryByText('$0.00/kWh')).not.toBeInTheDocument();
    expect(projection.queryByText('$0.00')).not.toBeInTheDocument();
    expect(projection.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(projection.getByText('54.75 kWh')).toBeInTheDocument();
  });

  it.each([true, false])('preserves measured zero price and signed fractional temperature with settings available=%s', (available) => {
    pricingFixture.available = available;
    const data = fullyPopulatedData();
    data.base_cost_per_kwh = 0;
    data.recent_events![0].outside_temp = -2.75;
    mockSleep.mockReturnValue(queryResult({ data }));
    renderPage();
    expect(screen.getByText(available ? '$0.00/kWh' : '0.00 (Currency: Unavailable)/kWh')).toBeInTheDocument();
    expect(screen.getByText(available ? '$0.00' : '0.00 (Currency: Unavailable)')).toBeInTheDocument();
    expect(screen.getByText('-2.75 °C')).toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
  });

  it('restores currency identity when existing settings recover without refetching sleep', () => {
    pricingFixture.available = false;
    mockSleep.mockReturnValue(queryResult({ data: fullyPopulatedData() }));
    const page = renderPage();
    expect(screen.getByText('6.57 (Currency: Unavailable)')).toBeInTheDocument();
    pricingFixture.available = true;
    pricingFixture.symbol = '£';
    page.rerenderPage();
    expect(screen.getByText('£6.57')).toBeInTheDocument();
    expect(screen.queryByText('6.57 (Currency: Unavailable)')).not.toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
  });

  it('keeps the scientific matrix columns fixed', () => {
    renderPage();
    const matrix = screen.getByTestId('sleep-efficiency-availability-matrix');
    expect(within(matrix).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(matrix).queryByRole('button', { name: /columns/i })).not.toBeInTheDocument();
    expect(within(matrix).queryAllByLabelText(/^Resize column/)).toHaveLength(0);
    expect(matrix.querySelector('[draggable="true"]')).toBeNull();
  });

  it('mounts all 14 section shells', () => {
    renderPage();
    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('passes the exact half-open header instants to the canonical hook', () => {
    renderPage();
    expect(mockSleep).toHaveBeenCalledWith(
      '1',
      30,
      '2026-06-17T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z',
    );
    expect(screen.queryByTestId('sleep-efficiency-range')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(
      screen.getByTestId('sleep-efficiency-kpi-evidence'),
      'Jun 17, 2026 to Jul 16, 2026',
      { contains: true },
    );
  });

  it('updates header instants on a mounted clock change without rewriting source rows', () => {
    const data = fullyPopulatedData();
    const original = structuredClone(data);
    mockSleep.mockReturnValue(queryResult({ data }));
    const view = renderPage(['/sleep-efficiency?from=2026-03-08&to=2026-03-08']);
    expect(mockSleep).toHaveBeenLastCalledWith(
      '1', 1, '2026-03-08T00:00:00.000Z', '2026-03-09T00:00:00.000Z',
    );
    dateSettings.timezone_user = 'America/Los_Angeles';
    dateSettings.locale = 'de-DE';
    view.rerenderPage();
    expect(mockSleep).toHaveBeenLastCalledWith(
      '1', 1, '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z',
    );
    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(data).toEqual(original);
    expect(screen.getByTestId('sleep-analysis-as-of')).not.toHaveTextContent(/UTC|T\d\d:\d\d/);
  });

  it('keeps all shells mounted with no vehicle and disables evidence values', () => {
    selectVehicle(null);
    mockSleep.mockReturnValue(
      queryResult({ isSuccess: false, data: undefined }),
    );
    renderPage();

    expect(mockSleep).toHaveBeenCalledWith(
      null,
      30,
      '2026-06-17T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z',
    );
    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(
      screen.getAllByText('Select a vehicle to make sleep evidence available.')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Source readings unavailable');
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
  });

  it('keeps every shell mounted while the initial query loads', () => {
    mockSleep.mockReturnValue(
      queryResult({
        data: undefined,
        isSuccess: false,
        isLoading: true,
        isFetching: true,
      }),
    );
    const { container } = renderPage();

    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[role="status"] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThan(
      0,
    );
    assertOperationalBriefDisclosure(document.body, 'Loading source evidence');
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
  });

  it('shows exactly one retry surface for an initial query error', () => {
    const refetch = vi.fn();
    mockSleep.mockReturnValue(
      queryResult({
        data: undefined,
        isSuccess: false,
        isError: true,
        error: new Error('sleep unavailable'),
        refetch,
      }),
    );
    renderPage();

    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retains cached evidence and discloses a refresh error', () => {
    mockSleep.mockReturnValue(
      queryResult({
        data: transitionOnlyData(),
        isSuccess: false,
        isError: true,
        error: new Error('refresh failed'),
      }),
    );
    renderPage();

    expect(screen.getByTestId('sleep-refresh-error')).toHaveTextContent(
      'Sleep evidence could not refresh',
    );
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    const refreshEvidence = screen.getByTestId('sleep-efficiency-kpi-evidence');
    assertOperationalMetricUnavailable(refreshEvidence, 'Duration-based sleep efficiency');
    assertOperationalMetricUnavailable(refreshEvidence, 'Average time-to-sleep');
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('renders an empty success without measured-looking placeholder zeros', () => {
    mockSleep.mockReturnValue(
      queryResult({
        data: transitionOnlyData({
          state_distribution: [],
          battery_capacity_wh: null,
          capacity_source: null,
          base_cost_per_kwh: null,
        }),
      }),
    );
    renderPage();

    expect(
      screen.getByText('Dwell reconstruction unavailable'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sentry comparison unavailable'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Drain-event aggregates unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Source readings unavailable');
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
  });

  it('renders transition-only backend evidence as counts, never time or cost results', () => {
    renderPage();

    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.00%').length).toBeGreaterThan(0);
    const transitionEvidence = screen.getByTestId('sleep-efficiency-kpi-evidence');
    fireEvent.click(within(transitionEvidence).getByRole('button', { name: 'Review details' }));
    const transitionDialog = screen.getByRole('dialog');
    expect(within(transitionDialog).getByRole('group', { name: 'Asleep-transition share' })).toHaveTextContent('Count-based; not a time share');
    fireEvent.keyDown(transitionDialog, { key: 'Escape' });
    assertOperationalMetricUnavailable(transitionEvidence, 'Average time-to-sleep');
    expect(
      screen.getByText(
        'Monthly drain and cost remain unavailable because no count-bearing Sentry on/off comparison exists.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('renders duration, zero-safe Sentry, and validated future-response event evidence', () => {
    mockSleep.mockReturnValue(
      queryResult({ data: fullyPopulatedData() }),
    );
    renderPage();

    expect(screen.getAllByText('75.00%').length).toBeGreaterThan(0);
    expect(screen.getByText('12.00 min')).toBeInTheDocument();
    expect(screen.getAllByText('mystery').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown state').length).toBeGreaterThan(0);
    expect(screen.getByText('4 on · 5 off')).toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    expect(screen.getByText('$6.57')).toBeInTheDocument();
    const eventTable = within(
      screen.getByTestId('sleep-efficiency-event-directory'),
    ).getByRole('table');
    expect(
      within(eventTable).getByText('20.00 °C'),
    ).toBeInTheDocument();
  });

  it('converts SI event temperature at the display boundary', () => {
    unitState.fahrenheit = true;
    mockSleep.mockReturnValue(
      queryResult({ data: fullyPopulatedData() }),
    );
    renderPage();
    expect(screen.getByText('68.00 °F')).toBeInTheDocument();
    expect(screen.queryByText('20.00 °C')).not.toBeInTheDocument();
  });

  it('keeps historical recency and its as-of scope stable across refreshes and remounts', () => {
    const data = fullyPopulatedData();
    mockSleep.mockReturnValue(queryResult({ data }));
    const page = renderPage();
    const assertHistoricalScope = () => {
      expect(screen.getByTestId('sleep-analysis-as-of')).toHaveTextContent(
        'As of Jul 16, 2026, 11:59 PM',
      );
      const directory = within(screen.getByTestId('sleep-efficiency-event-directory'));
      expect(directory.getByText('Last 24 hours')).toBeInTheDocument();
      expect(directory.getByText('20.00 °C')).toBeInTheDocument();
      expect(directory.queryByText('Older')).not.toBeInTheDocument();
    };
    assertHistoricalScope();
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-08T12:00:00Z'));
    mockSleep.mockReturnValue(queryResult({ data: { ...data } }));
    page.rerenderPage();
    assertHistoricalScope();
    page.unmount();
    renderPage();
    assertHistoricalScope();
  });

  it('anchors current-window analysis to accepted response time, including delayed loads and refreshes', () => {
    const data = fullyPopulatedData();
    data.recent_events = [{
      ...data.recent_events![0],
      start_date: '2026-08-08T13:00:00Z',
      end_date: '2026-08-08T14:00:00Z',
      duration_hours: 1,
      drain_rate: 2,
    }];
    mockSleep.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
    const page = renderPage(['/sleep-efficiency?from=2026-08-08&to=2026-08-08']);
    expect(screen.queryByTestId('sleep-analysis-as-of')).not.toBeInTheDocument();

    const acceptedAt = Date.parse('2026-08-08T15:00:00Z');
    mockSleep.mockReturnValue(queryResult({ data, dataUpdatedAt: acceptedAt }));
    page.rerenderPage();
    expect(screen.getByTestId('sleep-analysis-as-of')).toHaveTextContent('Aug 8, 2026, 03:00 PM');
    expect(screen.getByText('20.00 °C')).toBeInTheDocument();

    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-08-10T12:00:00Z'));
    mockSleep.mockReturnValue(queryResult({
      data,
      dataUpdatedAt: acceptedAt,
      isError: true,
      error: new Error('refresh failed'),
    }));
    page.rerenderPage();
    expect(screen.getByTestId('sleep-analysis-as-of')).toHaveTextContent('Aug 8, 2026, 03:00 PM');
    expect(within(screen.getByTestId('sleep-efficiency-event-directory')).getByText('Last 24 hours')).toBeInTheDocument();

    mockSleep.mockReturnValue(queryResult({
      data,
      dataUpdatedAt: Date.parse('2026-08-08T16:00:00Z'),
    }));
    page.rerenderPage();
    expect(screen.getByTestId('sleep-analysis-as-of')).toHaveTextContent('Aug 8, 2026, 04:00 PM');
  });

  it('caps future-event classification at the historical window even for a newer response', () => {
    let wallNow = Date.parse('2026-08-08T12:00:00Z');
    vi.mocked(Date.now).mockImplementation(() => wallNow);
    const futureData = fullyPopulatedData();
    futureData.recent_events = [
      {
        id: 11,
        start_date: '2026-08-08T13:00:00Z',
        end_date: '2026-08-08T14:00:00Z',
        duration_hours: 1,
        battery_lost: 1,
        drain_rate: 1,
        sentry_mode: false,
        outside_temp: 10,
        start_battery: 80,
        end_battery: 79,
      },
    ];
    mockSleep.mockReturnValue(queryResult({ data: futureData }));
    const rendered = renderPage();
    expect(
      screen.getByText(
        'No event passed timestamp, future, duration, battery, and duplicate validation.',
      ),
    ).toBeInTheDocument();

    wallNow = Date.parse('2026-08-09T12:00:00Z');
    mockSleep.mockReturnValue(
      queryResult({
        data: {
          ...futureData,
          period_days: 31,
          recent_events: [...(futureData.recent_events ?? [])],
        },
      }),
    );
    rendered.rerender(
      <MemoryRouter
        initialEntries={[
          '/sleep-efficiency?from=2026-06-17&to=2026-07-16',
        ]}
      >
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <ToastProvider>
            <SleepEfficiencyPage />
            <HeaderRangeControl />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(
        'No event passed timestamp, future, duration, battery, and duplicate validation.',
      ),
    ).toBeInTheDocument();
  });

  it('requeries when the shared header chooses a one-day range', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('header-sleep-range'));

    await waitFor(() => {
      expect(mockSleep.mock.calls.some((call) => call[1] === 1)).toBe(true);
    });
    const oneDayCall = mockSleep.mock.calls.find((call) => call[1] === 1);
    expect(oneDayCall?.[0]).toBe('1');
    expect(typeof oneDayCall?.[2]).toBe('string');
    expect(typeof oneDayCall?.[3]).toBe('string');
  });

  it('keeps all sections unknown during an initially paused request and refreshes on demand', () => {
    const refetch = vi.fn();
    mockSleep.mockReturnValue(queryResult({
      data: undefined,
      isSuccess: false,
      isPending: true,
      fetchStatus: 'paused',
      refetch,
    }));
    renderPage();

    for (const testId of SECTION_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    const paused = screen.getByTestId('sleep-initial-paused');
    assertOperationalBriefDisclosure(document.body, 'Source readings unavailable');
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
    expect(paused).toHaveTextContent('No drain or sleep-health conclusion is available.');
    const refresh = within(paused).getByRole('button', { name: 'Refresh' });
    expect(refresh).toHaveClass('min-h-11', 'md:min-h-9');
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('sleep-efficiency-kpi-evidence'))
      .getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText(/request is paused/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).getAllByText(/Jun 17, 2026 to Jul 16, 2026/).length).toBeGreaterThan(0);
  });

  it('retains duration and energy during a paused refresh without inventing a fetch error', () => {
    const refetch = vi.fn();
    mockSleep.mockReturnValue(queryResult({
      data: fullyPopulatedData(),
      fetchStatus: 'paused',
      refetch,
    }));
    renderPage();

    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('Previously loaded data remains visible.');
    assertOperationalBriefDisclosure(document.body, 'Retained source evidence');
    expect(screen.queryByTestId('sleep-refresh-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sleep-initial-paused')).not.toBeInTheDocument();
    expect(screen.getAllByText('75.00%').length).toBeGreaterThan(0);
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('isolates a failed transition widget and retries without erasing neighboring evidence', () => {
    widgetState.failDestination = true;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSleep.mockReturnValue(queryResult({ data: fullyPopulatedData() }));
    renderPage();

    expect(screen.getByText('Synthetic transition widget failure')).toBeInTheDocument();
    expect(screen.queryByTestId('sleep-efficiency-transition-distribution')).not.toBeInTheDocument();
    for (const testId of SECTION_TEST_IDS.filter((id) => id !== 'sleep-efficiency-transition-distribution')) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    expect(screen.getAllByText('75.00%').length).toBeGreaterThan(0);
    widgetState.failDestination = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByTestId('sleep-efficiency-transition-distribution')).toBeInTheDocument();
    expect(screen.queryByText('Synthetic transition widget failure')).not.toBeInTheDocument();
    expect(errorLog).toHaveBeenCalled();
  });

  it('keeps Sentry evidence independent when dwell evidence is absent', () => {
    const data = fullyPopulatedData();
    data.state_distribution = [{ state: 'asleep', count: 8, total_minutes: 0 }];
    data.time_to_sleep_avg_min = 0;
    mockSleep.mockReturnValue(queryResult({ data }));
    renderPage();

    expect(screen.getByText('Duration diagnostic withheld')).toBeInTheDocument();
    expect(screen.getByText('Dwell reconstruction unavailable')).toBeInTheDocument();
    expect(screen.getByText('4 on · 5 off')).toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    expect(screen.getByText('$6.57')).toBeInTheDocument();
    for (const testId of ['sleep-efficiency-kpi-evidence', 'sleep-efficiency-diagnostics']) {
      expect(within(screen.getByTestId(testId)).queryByText('0.00%')).not.toBeInTheDocument();
    }
  });

  it('preserves count-bearing measured zero without promoting missing Sentry evidence to zero', () => {
    const data = fullyPopulatedData();
    data.sentry_comparison = [
      { sentry_mode: true, count: 4, avg_drain_rate: 0, avg_battery_lost: 0, avg_duration_hours: 5 },
      { sentry_mode: false, count: 5, avg_drain_rate: 0, avg_battery_lost: 0, avg_duration_hours: 6 },
    ];
    mockSleep.mockReturnValue(queryResult({ data }));
    renderPage();

    const projection = screen.getByTestId('sleep-efficiency-sentry-projection');
    expect(within(projection).getByText('0.00 kWh')).toBeInTheDocument();
    expect(within(projection).getByText('$0.00')).toBeInTheDocument();
    expect(within(projection).getByText('0.00%/hr')).toBeInTheDocument();
    expect(within(projection).getByText('4 on · 5 off')).toBeInTheDocument();
    expect(screen.queryByText('Sentry comparison unavailable')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Available source readings');
  });

  it('clears retained status after refresh recovery without losing source evidence or scope', () => {
    const data = fullyPopulatedData();
    mockSleep.mockReturnValue(queryResult({ data, isError: true, isSuccess: false, error: new Error('refresh failed') }));
    const rendered = renderPage();
    assertOperationalBriefDisclosure(document.body, 'Retained source evidence');
    expect(screen.getByTestId('sleep-refresh-error')).toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();

    mockSleep.mockReturnValue(queryResult({ data, isFetching: true, fetchStatus: 'fetching' }));
    rendered.rerenderPage();
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();

    mockSleep.mockReturnValue(queryResult({ data }));
    rendered.rerenderPage();
    assertOperationalBriefDisclosure(document.body, 'Available source readings');
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sleep-refresh-error')).not.toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    assertOperationalBriefDisclosure(
      screen.getByTestId('sleep-efficiency-kpi-evidence'),
      'Jun 17, 2026 to Jul 16, 2026',
      { contains: true },
    );
  });

  it('preserves dwell ratios, duplicate policy, and exact state exclusion accounting', () => {
    const data = fullyPopulatedData();
    data.state_distribution = [
      { state: 'asleep', count: 8, total_minutes: 90 },
      { state: 'online', count: 2, total_minutes: 30 },
      { state: ' ASLEEP ', count: 99, total_minutes: 300 },
      { state: null, count: 3, total_minutes: 5 },
      { state: 'offline', count: -1, total_minutes: 10 },
      { state: 'charging', count: 1, total_minutes: -1 },
    ];
    mockSleep.mockReturnValue(queryResult({ data }));
    renderPage();

    expect(screen.getAllByText('75.00%').length).toBeGreaterThan(0);
    const table = within(screen.getByTestId('sleep-efficiency-range-source-coverage')).getByRole('table');
    for (const category of ['Duplicate state', 'Missing state', 'Invalid count', 'Invalid minutes']) {
      const row = within(table).getByRole('row', { name: `State rows ${category} 1` });
      expect(within(row).getByText('1')).toBeInTheDocument();
    }
    const included = within(table).getByRole('row', { name: 'State rows Included 2' });
    expect(within(included).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('20.00 °C')).toBeInTheDocument();
  });
});
