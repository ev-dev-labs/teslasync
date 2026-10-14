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
const widgetState = vi.hoisted(() => ({ failDestination: false }));

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
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: (value: number) => `$${value.toFixed(2)}`,
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
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
    dataUpdatedAt: 1,
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
        start_date: '2026-08-06T01:00:00Z',
        end_date: '2026-08-06T05:00:00Z',
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
  widgetState.failDestination = false;
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

  it('passes the exact inclusive URL range to the canonical hook', () => {
    renderPage();
    expect(mockSleep).toHaveBeenCalledWith(
      '1',
      30,
      '2026-06-17',
      '2026-07-16',
    );
    expect(screen.queryByTestId('sleep-efficiency-range')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('sleep-efficiency-kpi-evidence')).getByText(
        '2026-06-17 to 2026-07-16 UTC', { selector: '[data-battery-period]' },
      ),
    ).toBeInTheDocument();
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
      '2026-06-17',
      '2026-07-16',
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
    expect(screen.getByText('Source readings unavailable')).toBeInTheDocument();
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
    expect(screen.getByText('Loading source evidence')).toBeInTheDocument();
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
    expect(
      screen.getAllByText('Unavailable pending dwell reconstruction').length,
    ).toBeGreaterThan(0);
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
    expect(screen.getByText('Source readings unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
  });

  it('renders transition-only backend evidence as counts, never time or cost results', () => {
    renderPage();

    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.00%').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('sleep-efficiency-kpi-evidence')).getByText(
        'Count-based; not a time share', { selector: '[data-battery-detail-context]' },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Placeholder zero withheld'),
    ).toBeInTheDocument();
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

  it('freezes the analysis clock once for future-event classification', () => {
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
    expect(screen.getByText('Source readings unavailable')).toBeInTheDocument();
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
    expect(within(screen.getByRole('dialog')).getAllByText(/2026-06-17 to 2026-07-16 UTC/).length).toBeGreaterThan(0);
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
    expect(screen.getByText('Retained source evidence')).toBeInTheDocument();
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
    expect(screen.getByText('Available source readings')).toBeInTheDocument();
  });

  it('clears retained status after refresh recovery without losing source evidence or scope', () => {
    const data = fullyPopulatedData();
    mockSleep.mockReturnValue(queryResult({ data, isError: true, isSuccess: false, error: new Error('refresh failed') }));
    const rendered = renderPage();
    expect(screen.getByText('Retained source evidence')).toBeInTheDocument();
    expect(screen.getByTestId('sleep-refresh-error')).toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();

    mockSleep.mockReturnValue(queryResult({ data, isFetching: true, fetchStatus: 'fetching' }));
    rendered.rerenderPage();
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();

    mockSleep.mockReturnValue(queryResult({ data }));
    rendered.rerenderPage();
    expect(screen.getByText('Available source readings')).toBeInTheDocument();
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sleep-refresh-error')).not.toBeInTheDocument();
    expect(screen.getByText('54.75 kWh')).toBeInTheDocument();
    expect(screen.getByText('2026-06-17 to 2026-07-16 UTC', { selector: '[data-battery-period]' })).toBeInTheDocument();
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
