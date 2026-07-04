/**
 * SleepEfficiencyPage contract + hardening tests.
 *
 * SleepEfficiencyPage renders the SI-canonical sleep/vampire-drain dashboard:
 * a six-tile KPI band, a bento of a state-distribution donut + a sentry
 * comparison bar chart + a monthly-sentry-impact callout, and a full-width
 * recent-drain-events table — all driven by a single `useSleepEfficiency`
 * query keyed on the selected vehicle and the RangePicker window.
 *
 * The data hook is mocked at the hook boundary so every branch (loading /
 * error / empty / no-vehicle / loaded) can be exercised deterministically
 * (recharts renders nothing meaningful in jsdom, so the component tests assert
 * the page's OWN branch selection — content vs. placeholder — rather than SVG
 * internals). The display hooks (`useUnits` / `useFormatting` → `useSettings`)
 * render for real, so the SI → display conversion at the render boundary is
 * exercised for both Celsius and Fahrenheit temperature preferences.
 *
 * The exported pure helpers (`computeRangeDays`, `buildStatePieData`,
 * `buildSentryComparison`, `hasSentryData`) are unit-tested directly with exact
 * assertions. `computeRangeDays` carries a regression guard for the NaN bug:
 * an unparseable bound previously leaked `NaN` into the `?days=` query string.
 *
 * Network never touches the real backend — the sleep hook is stubbed and
 * `useSelectedVehicle` is mocked so no vehicles query fires.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback/Toast';

// i18n stub: return the fallback string, interpolating {{var}} tokens so
// assertions can target the rendered English copy. When called with a bare
// key it echoes the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Mutable temperature preference so one file exercises both the Celsius and
// Fahrenheit display-conversion branches. Hoisted so the settings mock factory
// can close over it.
const unitState = vi.hoisted(() => ({ temp: 'C' as 'C' | 'F' }));

// File-level useSettings mock (overrides the global test-setup stub). Mirrors
// the production defaults so every transitive consumer sees the same shape but
// lets `unit_of_temp` flip per test.
vi.mock('@/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSettings')>();
  const defaults = {
    unit_of_length: 'km' as const,
    unit_of_temp: 'C' as const,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return {
    ...actual,
    useSettings: () => ({
      settings: { ...defaults, unit_of_temp: unitState.temp },
      isMiles: false,
      isFahrenheit: unitState.temp === 'F',
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

vi.mock('@/api/hooks/useEnergy', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useEnergy')>();
  return { ...actual, useSleepEfficiency: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { CHART_COLORS } from '@/lib/colors';
import type { SleepEfficiencyData } from '@/types/energy';
import SleepEfficiencyPage, {
  computeRangeDays,
  buildStatePieData,
  buildSentryComparison,
  hasSentryData,
  type SentryComparisonRow,
} from './SleepEfficiencyPage';

const mockSleep = vi.mocked(useSleepEfficiency);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeSleepData(over: Partial<SleepEfficiencyData> = {}): SleepEfficiencyData {
  return {
    sleep_efficiency_pct: 72.5,
    time_to_sleep_avg_min: 18,
    sentry_on_drain_rate: 1.2,
    sentry_off_drain_rate: 0.4,
    sentry_monthly_cost: 4.5,
    sentry_monthly_kwh: 15,
    sentry_extra_drain_rate: 0.8,
    sentry_extra_monthly_kwh: 6,
    sentry_extra_monthly_cost: 1.75,
    state_distribution: [
      { state: 'asleep', total_minutes: 600 },
      { state: 'online', total_minutes: 120 },
    ],
    sentry_comparison: [
      { sentry_mode: true, avg_drain_rate: 1.2, avg_battery_lost: 5 },
      { sentry_mode: false, avg_drain_rate: 0.4, avg_battery_lost: 2 },
    ],
    recent_events: [
      { id: 1, start_date: '2025-03-05T08:00:00Z', duration_hours: 8, battery_lost: 3.2, drain_rate: 0.4, sentry_mode: false, outside_temp: 20 },
      { id: 2, start_date: '2025-03-06T20:00:00Z', duration_hours: 6, battery_lost: 2.1, drain_rate: 1.8, sentry_mode: true, outside_temp: null },
    ],
    ...over,
  };
}

function installHappyPath() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [
      { id: 1, display_name: 'Car One', vin: 'VIN1' },
      { id: 2, display_name: 'Car Two', vin: 'VIN2' },
    ] as any,
    setVehicleId: vi.fn(),
  });
  mockSleep.mockReturnValue(qr({ data: makeSleepData() }));
}

function installNoVehicle() {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: null,
    vehicle: null,
    vehicles: [] as any,
    setVehicleId: vi.fn(),
  });
  mockSleep.mockReturnValue(qr({ data: undefined }));
}

function renderPage(entries: string[] = ['/battery/sleep']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

function kpiRegion() {
  return screen.getByRole('region', { name: 'Sleep efficiency metrics' });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unitState.temp = 'C';
  installHappyPath();
});

/* ───────────────────────── Pure helper unit tests ───────────────────────── */

describe('computeRangeDays', () => {
  it('returns the inclusive day count between two ISO calendar bounds', () => {
    expect(computeRangeDays('2025-03-01', '2025-03-07')).toBe(7);
    expect(computeRangeDays('2025-03-05', '2025-03-05')).toBe(1);
    expect(computeRangeDays('2025-03-01', '2025-03-31')).toBe(31);
  });

  it('falls back to the 30-day default when a bound is missing', () => {
    expect(computeRangeDays(null, '2025-03-07')).toBe(30);
    expect(computeRangeDays('2025-03-01', undefined)).toBe(30);
    expect(computeRangeDays('', '')).toBe(30);
  });

  it('guards against unparseable bounds instead of leaking NaN (regression)', () => {
    // Previously `new Date('bad').getTime()` → NaN → NaN days in the query URL.
    expect(computeRangeDays('not-a-date', '2025-03-07')).toBe(30);
    expect(Number.isNaN(computeRangeDays('2025-03-01', 'nope'))).toBe(false);
  });

  it('never returns less than one day even when end precedes start', () => {
    expect(computeRangeDays('2025-03-10', '2025-03-01')).toBe(1);
  });
});

describe('buildStatePieData', () => {
  const labels = { asleep: 'Sleeping', online: 'Online/Idle' };

  it('maps each state to a labelled, coloured slice with rounded minutes + hours', () => {
    const out = buildStatePieData(
      [
        { state: 'asleep', total_minutes: 600 },
        { state: 'online', total_minutes: 119.6 },
      ],
      labels,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'Sleeping', value: 600, color: '#a855f7', hours: '10.00' });
    expect(out[1].name).toBe('Online/Idle');
    expect(out[1].value).toBe(120); // rounded from 119.6
  });

  it('falls back to the raw state key + first chart colour for unknown states', () => {
    const out = buildStatePieData([{ state: 'mystery', total_minutes: 30 }], {});
    expect(out[0].name).toBe('mystery');
    expect(out[0].color).toBe(CHART_COLORS[0]);
    expect(out[0].hours).toBe('0.50');
  });

  it('null-safes a missing distribution or minutes to empty / zero', () => {
    expect(buildStatePieData(undefined, labels)).toEqual([]);
    const out = buildStatePieData([{ state: 'asleep', total_minutes: null as any }], labels);
    expect(out[0].value).toBe(0);
    expect(out[0].hours).toBe('0.00');
  });
});

describe('buildSentryComparison', () => {
  const labels = { drainRate: 'Drain Rate (%/hr)', batteryLost: 'Avg Battery Lost (%)' };

  it('pivots the on/off samples into two labelled grouped-bar rows', () => {
    const out = buildSentryComparison(
      [
        { sentry_mode: true, avg_drain_rate: 1.2, avg_battery_lost: 5 },
        { sentry_mode: false, avg_drain_rate: 0.4, avg_battery_lost: 2 },
      ],
      labels,
    );
    expect(out).toEqual([
      { name: 'Drain Rate (%/hr)', sentry_on: 1.2, sentry_off: 0.4 },
      { name: 'Avg Battery Lost (%)', sentry_on: 5, sentry_off: 2 },
    ]);
  });

  it('null-safes a missing side (or the whole comparison) to zero', () => {
    const onlyOn = buildSentryComparison(
      [{ sentry_mode: true, avg_drain_rate: 1, avg_battery_lost: 3 }],
      labels,
    );
    expect(onlyOn[0].sentry_off).toBe(0);
    expect(onlyOn[1].sentry_off).toBe(0);

    const none = buildSentryComparison(undefined, labels);
    expect(none[0]).toEqual({ name: 'Drain Rate (%/hr)', sentry_on: 0, sentry_off: 0 });
  });
});

describe('hasSentryData', () => {
  it('is true when any row carries a non-zero value', () => {
    const rows: SentryComparisonRow[] = [
      { name: 'a', sentry_on: 0, sentry_off: 0 },
      { name: 'b', sentry_on: 0, sentry_off: 2 },
    ];
    expect(hasSentryData(rows)).toBe(true);
  });

  it('is false for all-zero rows or an empty comparison', () => {
    expect(hasSentryData([{ name: 'a', sentry_on: 0, sentry_off: 0 }])).toBe(false);
    expect(hasSentryData([])).toBe(false);
  });
});

/* ─────────────────────────── Component tests ─────────────────────────── */

describe('SleepEfficiencyPage — shell & KPI band', () => {
  it('renders the page title + subtitle and sets the document title', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sleep Efficiency' })).toBeInTheDocument();
    expect(
      screen.getByText('Analyze vehicle sleep patterns, vampire drain, and sentry mode costs'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Sleep Efficiency');
  });

  it('renders every KPI card with its formatted value', () => {
    renderPage();
    const kpi = kpiRegion();
    expect(within(kpi).getByText('Sleep Efficiency')).toBeInTheDocument();
    expect(within(kpi).getByText('72.50%')).toBeInTheDocument();
    expect(within(kpi).getByText('18 min')).toBeInTheDocument();
    expect(within(kpi).getByText('1.20%/hr')).toBeInTheDocument(); // sentry-on drain
    expect(within(kpi).getByText('0.40%/hr')).toBeInTheDocument(); // sentry-off drain
    expect(within(kpi).getByText('15.00 kWh')).toBeInTheDocument();
    expect(within(kpi).getByText('$4.50')).toBeInTheDocument();
  });

  it('shows a labelled loading skeleton band (not the metric cards) while loading', () => {
    mockSleep.mockReturnValue(qr({ isLoading: true, isFetching: true }));
    const { container } = renderPage();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // KPI cards are replaced by skeletons — a card-only label + value are absent.
    expect(screen.queryByText('Avg Time to Sleep')).not.toBeInTheDocument();
    expect(screen.queryByText('72.50%')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows em-dash placeholders (never misleading zeros) when no vehicle is selected', () => {
    installNoVehicle();
    renderPage();
    const kpi = kpiRegion();
    // Silent-zero hardening: no "0.00%" / "$0.00" while the data is unknown.
    expect(within(kpi).queryByText('0.00%')).not.toBeInTheDocument();
    expect(within(kpi).queryByText('$0.00')).not.toBeInTheDocument();
    expect(within(kpi).getAllByText('—').length).toBeGreaterThanOrEqual(6);
  });

  it('converts each drain-event temperature at the render boundary (Celsius)', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByText('20.00°C')).toBeInTheDocument();
  });

  it('converts each drain-event temperature to Fahrenheit when preferred', () => {
    unitState.temp = 'F';
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByText('68.00°F')).toBeInTheDocument(); // 20°C → 68°F
    expect(within(table).queryByText('20.00°C')).not.toBeInTheDocument();
  });
});

describe('SleepEfficiencyPage — charts & sentry impact', () => {
  it('renders the donut legend on the happy path and the empty state when absent', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 3, name: 'State Distribution' })).toBeInTheDocument();
    // Per-state legend rows carry the localized label + hours.
    expect(screen.getByText('Sleeping')).toBeInTheDocument();
    expect(screen.getByText('10.00h')).toBeInTheDocument();
    expect(screen.queryByText('No state distribution data available')).not.toBeInTheDocument();

    mockSleep.mockReturnValue(qr({ data: makeSleepData({ state_distribution: [] }) }));
    renderPage();
    expect(
      screen.getAllByText('No state distribution data available').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders the sentry comparison chart when there is data and an empty state otherwise', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 3, name: 'Sentry vs No-Sentry' })).toBeInTheDocument();
    expect(screen.queryByText('No sentry comparison data available')).not.toBeInTheDocument();

    // All-zero comparison → hasSentryData false → placeholder.
    mockSleep.mockReturnValue(
      qr({
        data: makeSleepData({
          sentry_comparison: [
            { sentry_mode: true, avg_drain_rate: 0, avg_battery_lost: 0 },
            { sentry_mode: false, avg_drain_rate: 0, avg_battery_lost: 0 },
          ],
        }),
      }),
    );
    renderPage();
    expect(screen.getAllByText('No sentry comparison data available').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the monthly sentry-impact figures, dashing them out when data is absent', () => {
    const { unmount } = renderPage();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Monthly Sentry Mode Impact' }),
    ).toBeInTheDocument();
    expect(screen.getByText('0.80%')).toBeInTheDocument(); // extra drain/hr
    expect(screen.getByText('6.00 kWh')).toBeInTheDocument(); // extra monthly kWh
    expect(screen.getByText('$1.75')).toBeInTheDocument(); // extra cost/mo
    unmount();

    installNoVehicle();
    renderPage();
    // The impact panel now shows em-dashes rather than "0.00%" / "$0.00".
    expect(screen.queryByText('0.80%')).not.toBeInTheDocument();
    expect(screen.getByText('Extra drain/hr')).toBeInTheDocument();
  });
});

describe('SleepEfficiencyPage — recent drain events table', () => {
  it('renders a row per event with drain colour thresholds and sentry badges', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByText('8.00h')).toBeInTheDocument(); // duration
    expect(within(table).getByText('3.20%')).toBeInTheDocument(); // battery lost
    expect(within(table).getByText('0.40%/hr')).toBeInTheDocument(); // low drain (emerald)
    expect(within(table).getByText('1.80%/hr')).toBeInTheDocument(); // high drain (rose)
    // Sentry column badges: one On (event 2) + one Off (event 1).
    expect(within(table).getByText('On')).toBeInTheDocument();
    expect(within(table).getByText('Off')).toBeInTheDocument();
    // Event 2 has no outside temp → em-dash placeholder.
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('shows a table skeleton while loading and an empty state when there are no events', () => {
    mockSleep.mockReturnValue(qr({ isLoading: true }));
    const { unmount } = renderPage();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    unmount();

    mockSleep.mockReturnValue(qr({ data: makeSleepData({ recent_events: [] }) }));
    renderPage();
    expect(screen.getByText('No drain events recorded yet')).toBeInTheDocument();
  });
});

describe('SleepEfficiencyPage — error handling', () => {
  it('surfaces a page-level alert and retry-able section errors, re-fetching on retry', async () => {
    const refetch = vi.fn();
    installNoVehicle();
    mockSleep.mockReturnValue(
      qr({ isError: true, error: new Error('sleep down'), refetch }),
    );
    renderPage();

    expect(screen.getByText('Failed to load sleep efficiency data')).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(retries[0]);
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});

describe('SleepEfficiencyPage — data contract & controls', () => {
  it('queries the sleep endpoint with a snake_case-free positional signature derived from the URL', () => {
    renderPage(['/battery/sleep?from=2025-03-01&to=2025-03-07']);
    // Inclusive 7-day window, string vehicle id, explicit start/end passthrough.
    expect(mockSleep).toHaveBeenCalledWith('1', 7, '2025-03-01', '2025-03-07');
  });

  it('re-queries with a one-day window when the "Today" preset is picked', async () => {
    renderPage(['/battery/sleep?from=2025-03-01&to=2025-03-07']);
    expect(mockSleep).toHaveBeenCalledWith('1', 7, '2025-03-01', '2025-03-07');

    fireEvent.click(screen.getByTestId('sleep-efficiency-range'));
    const listbox = await screen.findByRole('listbox', { name: 'Quick date range' });
    fireEvent.click(within(listbox).getByRole('option', { name: 'Today' }));

    await waitFor(() =>
      expect(mockSleep).toHaveBeenCalledWith('1', 1, expect.any(String), expect.any(String)),
    );
  });

  it('exposes accessible vehicle + range controls and named chart/section regions', () => {
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();
    expect(screen.getByTestId('sleep-efficiency-range')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sleep efficiency metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sleep and sentry analysis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Recent Drain Events' })).toBeInTheDocument();
  });
});
