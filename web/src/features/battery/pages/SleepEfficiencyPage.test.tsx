import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type SleepQueryResult = ReturnType<typeof useSleepEfficiency>;

const mockSleep = vi.mocked(useSleepEfficiency);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

function queryResult(
  overrides: Partial<{
    data: SleepEfficiencyData | undefined;
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    isSuccess: boolean;
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
  return render(
    <MemoryRouter initialEntries={entries}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <SleepEfficiencyPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.fahrenheit = false;
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
    expect(screen.getByTestId('sleep-efficiency-range')).toBeInTheDocument();
    expect(
      screen.getByText('2026-06-17 to 2026-07-16 UTC'),
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
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    );
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
  });

  it('renders transition-only backend evidence as counts, never time or cost results', () => {
    renderPage();

    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('80.00%').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Count-based; not a time share'),
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

  it('keeps the RangePicker interactive and requeries a one-day preset', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('sleep-efficiency-range'));
    const listbox = await screen.findByRole('listbox', {
      name: 'Quick date range',
    });
    fireEvent.click(within(listbox).getByRole('option', { name: 'Today' }));

    await waitFor(() => {
      expect(mockSleep.mock.calls.some((call) => call[1] === 1)).toBe(true);
    });
    const oneDayCall = mockSleep.mock.calls.find((call) => call[1] === 1);
    expect(oneDayCall?.[0]).toBe('1');
    expect(typeof oneDayCall?.[2]).toBe('string');
    expect(typeof oneDayCall?.[3]).toBe('string');
  });
});
