/**
 * ChargingDetailPage — behaviour + hardening coverage.
 *
 * The page exposes a single default export. This suite drives it through every
 * meaningful branch by mocking its data hooks (`useChargingSessionDetail` /
 * `useChargeTelemetry` / `useVehicle` / `useChargingTelemetryLatest`), the unit
 * preference, and the currency formatter. The SI → display converters
 * (`@/lib/unitConversion`) and number formatters (`@/lib/numberFormat`) are the
 * REAL implementations so the render-boundary maths is genuinely exercised.
 * Network is never touched.
 *
 * Facets covered:
 *   - loading: the bento skeleton stands in and page content is withheld.
 *   - primary-resource error: a 404 shows the "not found" recovery with a
 *     back-to-list CTA; a 5xx surfaces a working Retry wired to refetch.
 *   - populated DC session (with telemetry + live state): header status chips,
 *     the eight-tile KPI band, the five live gauges (incl. the DC 250 kW gauge
 *     ceiling), battery-progress read-outs, the charge-summary inline metrics,
 *     the advanced live-charging KVList, session info + timestamps.
 *   - the "Range Added" regression: the row reads the SI TOTAL field
 *     (`range_added_meters`) converted ONCE — never the per-hour rate with a
 *     spurious /1000. Distinct from the "Charge Rate" row above it.
 *   - AC session without telemetry: AC chip, 22 kW gauge ceiling, the
 *     "(estimated)" charge-curve tag, the estimated-cost tile + "at $/kWh"
 *     hint, the per-kWh "from settings" fallback, and per-panel empty states.
 *   - telemetry error isolation: a telemetry 5xx surfaces QueryError (with a
 *     Retry that calls refetch) in the three time-axis panels while the KPI
 *     band and synthesized charge curve stay intact.
 *   - live-state branches: the advanced panel shows loading skeletons while the
 *     latest query is pending and its own empty state when there is no live row.
 *   - ongoing session (no ended_at): duration collapses to 0, the Ended slot
 *     renders the em-dash placeholder, an absent vehicle falls back to "ID N",
 *     and a placeless session shows the location empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import type { ChargingSession, ChargeTelemetryReading, ChargingTelemetry } from '@/api/types';

// ── i18n stub: resolve a string fallback (or the options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props, keep motion.* + AnimatePresence. ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              [
                'animate', 'initial', 'exit', 'transition', 'whileHover',
                'whileTap', 'whileInView', 'viewport', 'variants',
              ].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── charts: deterministic doubles. The page renders raw recharts through the
//    shared barrel; recharts needs a sized container that jsdom can't give it,
//    so we swap the whole module for inert passthroughs. LinearGauge surfaces
//    its label/value/max as data-* so gauge maths stays assertable. ───────────
vi.mock('@/components/charts', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    LinearGauge: ({
      label,
      value,
      unit,
      max,
    }: {
      label?: string;
      value?: number;
      unit?: string;
      max?: number;
    }) => (
      <div
        data-testid="gauge"
        data-label={label ?? ''}
        data-value={String(value)}
        data-unit={unit ?? ''}
        data-max={String(max)}
      />
    ),
    ResponsiveContainer: Passthrough,
    AreaChart: Passthrough,
    ComposedChart: Passthrough,
    Area: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
    ChartBrush: () => null,
    ChartTooltip: () => null,
    ChartTimeRangeProvider: Passthrough,
    useSyncedCursor: () => ({ syncId: 'test', syncMethod: 'value', onMouseMove: () => {} }),
    useSyncedReferenceLineX: () => null,
    chartGrid: null,
    axisTickSm: {},
    chartMargin: {},
    AREA_DEFAULTS: {},
    areaGradient: () => null,
  };
});

// The AI diagnosis card is gated by ai_mode (off in test-setup) and reaches for
// a streaming endpoint; it is covered by its own suite. Inert here.
vi.mock('@/components/ai/AIChargingDiagnosis', () => ({
  AIChargingDiagnosis: () => null,
}));

// ── Data + environment hooks, driven per test. ──
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionDetail: vi.fn(),
  useChargeTelemetry: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: vi.fn(),
  useChargingTelemetryLatest: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: vi.fn() }));

import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import ChargingDetailPage from './ChargingDetailPage';

const mockSession = useChargingSessionDetail as unknown as ReturnType<typeof vi.fn>;
const mockTelemetry = useChargeTelemetry as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useVehicle as unknown as ReturnType<typeof vi.fn>;
const mockLive = useChargingTelemetryLatest as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;
const mockFormatting = useFormatting as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  };
}

function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 42,
    vehicle_id: 7,
    started_at: '2024-03-10T08:00:00Z',
    ended_at: '2024-03-10T09:00:00Z', // exactly 60 min
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: 37.5,
    start_lng: -122.3,
    start_place: 'Supercharger — Fremont',
    total_energy_added_wh: 50_000, // 50 kWh
    peak_power_w: 150_000, // 150 kW
    avg_power_w: 100_000, // 100 kW
    cost_decimal: 12.5,
    cost_currency: 'USD',
    charger_type: 'DC',
    cable_type: 'CCS',
    startedAt: '2024-03-10T08:00:00Z',
    duration_min: 60,
    ended_status: 'Complete',
    ...over,
  };
}

function makeReading(over: Partial<ChargeTelemetryReading> = {}): ChargeTelemetryReading {
  return {
    session_id: 42,
    vehicle_id: 7,
    ts: '2024-03-10T08:15:00Z',
    ac_charging_power_w: null,
    dc_charging_power_w: null,
    ac_charging_energy_in_wh: null,
    dc_charging_energy_in_wh: null,
    charger_voltage_v: null,
    charger_actual_current_a: null,
    charger_pilot_current_a: null,
    charger_phases: null,
    battery_heater_on: null,
    battery_heater_power_w: null,
    charge_limit_soc_pct: null,
    charge_request: null,
    fast_charger_type: null,
    charging_cable_type: null,
    charge_port_door_open: null,
    charge_port_latch: null,
    created_at: '2024-03-10T08:15:00Z',
    battery_level: 40,
    soc: 40,
    power_kw: 120,
    energy_added: 10,
    rated_range: 200_000,
    battery_temp: 25,
    inside_temp: 21,
    outside_temp: 12,
    voltage: 400,
    current_amps: 250,
    ...over,
  };
}

const TELEMETRY: ChargeTelemetryReading[] = [
  makeReading({ created_at: '2024-03-10T08:05:00Z', battery_level: 30, power_kw: 150 }),
  makeReading({ created_at: '2024-03-10T08:30:00Z', battery_level: 55, power_kw: 110 }),
  makeReading({ created_at: '2024-03-10T08:55:00Z', battery_level: 79, power_kw: 45 }),
];

function makeLive(over: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7,
    ts: '2024-03-10T08:45:00Z',
    session_id: 42,
    battery_level: 78,
    battery_range_mi: 320_000, // "misleading" suffix — actually SI meters → 320 km
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 24.5,
    charger_power_w: 11_000,
    charger_phases: 3,
    charge_energy_added_wh: 12_000,
    range_added_meters: 45_000, // total → 45.0 km (the "Range Added" row)
    range_added_meters_per_hour: 30_000, // rate → 30.0 km/h (the "Charge Rate" row)
    charger_pilot_current: 32,
    scheduled_charging_at: null,
    source: 'test',
    ...over,
  };
}

const VEHICLE = { id: 7, display_name: 'My Model 3', vin: 'VINDC00007' };

// A currency formatter matching the real hook contract closely enough to assert.
const formattingReturn = () => ({
  costPerKwh: 0.12,
  currencySymbol: '$',
  formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
  formatCurrency: (amount: number, decimals = 2) => `$${Number(amount).toFixed(decimals)}`,
});

const unitReturn = (distance: 'km' | 'mi' = 'km') => ({
  unitPrefs: {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
  },
  formatEnergy: (wh: number | null | undefined) => `${(Number(wh ?? 0) / 1000).toFixed(1)} kWh`,
  formatDistance: (v: number) => String(v),
  formatSpeed: (v: number) => String(v),
  formatTemperature: (v: number) => String(v),
  formatPressure: (v: number) => String(v),
  formatDuration: (v: number) => String(v),
  formatPower: (v: number) => String(v),
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/charging/42']}>
      <QueryClientProvider client={client}>
        <ChargingDetailPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Key metrics' });

/** Value <p> immediately following a MetricCard's label text. */
function cardValue(scope: HTMLElement, label: string): string {
  return within(scope).getByText(label).closest('p')?.nextElementSibling?.textContent ?? '';
}

/** The <dd> paired with a KVList <dt> label. */
function kvValue(label: string): string {
  return screen.getByText(label).closest('div')?.querySelector('dd')?.textContent ?? '';
}

/** The LinearGauge double carrying a given label. */
function gauge(label: string): HTMLElement {
  const el = screen.getAllByTestId('gauge').find((g) => g.getAttribute('data-label') === label);
  if (!el) throw new Error(`gauge not found: ${label}`);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path wiring: a completed DC session with telemetry + live.
  mockUnits.mockReturnValue(unitReturn('km'));
  mockFormatting.mockReturnValue(formattingReturn());
  mockSession.mockReturnValue(makeQuery({ data: makeSession() }));
  mockTelemetry.mockReturnValue(makeQuery({ data: TELEMETRY }));
  mockVehicle.mockReturnValue(makeQuery({ data: VEHICLE }));
  mockLive.mockReturnValue(makeQuery({ data: makeLive() }));
});

describe('ChargingDetailPage — loading', () => {
  it('renders the bento skeleton and withholds page content until the session resolves', () => {
    mockSession.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByTestId('charging-detail-skeleton')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Charge Session', level: 1 }),
    ).toBeInTheDocument();
    // Populated-only affordances must be absent behind the skeleton.
    expect(screen.queryByRole('region', { name: 'Key metrics' })).toBeNull();
    expect(screen.queryByText('Live Gauges')).toBeNull();
  });
});

describe('ChargingDetailPage — primary-resource error', () => {
  it('shows a not-found recovery with a back-to-list CTA for a 404', () => {
    mockSession.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('missing', 404), isError: true }),
    );
    renderPage();

    expect(screen.getByText('Charge session not found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument();
    // No page body when the record is missing.
    expect(screen.queryByRole('region', { name: 'Key metrics' })).toBeNull();
  });

  it('surfaces a server error with a Retry that refetches the session for a 5xx', () => {
    const refetch = vi.fn();
    mockSession.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('boom', 500), isError: true, refetch }),
    );
    renderPage();

    expect(screen.getByText('Server error')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ChargingDetailPage — populated DC session', () => {
  it('renders the header status chips and the session title', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Charge Session #42', level: 1 })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Session summary' });
    // DC chip + live charging-state chip + charger-type chip + place chip.
    expect(within(summary).getAllByText('DC').length).toBeGreaterThanOrEqual(1);
    expect(within(summary).getByText('Charging')).toBeInTheDocument();
    expect(within(summary).getByText('Supercharger — Fremont')).toBeInTheDocument();
    // Icon-only back link exposes an accessible name.
    expect(within(summary).getByRole('link', { name: 'Back to charging' })).toBeInTheDocument();
  });

  it('derives the eight-tile KPI band from the SI session fields', () => {
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Energy')).toBe('50.00 kWh');
    expect(cardValue(kpi, 'Duration')).toBe('60 min');
    expect(cardValue(kpi, 'Peak Power')).toBe('150.00 kW');
    expect(cardValue(kpi, 'SoC Range')).toBe('20–80%');
    expect(cardValue(kpi, 'Total Cost')).toBe('$12.50');
    // 12.5 / (50000 Wh / 1000) = $0.25 per kWh.
    expect(cardValue(kpi, 'Per kWh')).toBe('$0.25/kWh');
    // 50 kWh over 60 min → 50 kWh/h.
    expect(cardValue(kpi, 'kWh/h Avg')).toBe('50.00 kWh/h');
    // No odometer delta on this session → em-dash, never NaN.
    expect(cardValue(kpi, 'Miles Added')).toBe('—');
  });

  it('renders the five live gauges with SI-converted values and the DC 250 kW ceiling', () => {
    renderPage();

    expect(gauge('Energy Added').getAttribute('data-value')).toBe('50');
    expect(gauge('End SoC').getAttribute('data-value')).toBe('80');
    expect(gauge('Peak Power').getAttribute('data-value')).toBe('150');
    expect(gauge('Duration').getAttribute('data-value')).toBe('60');
    expect(gauge('Avg Power').getAttribute('data-value')).toBe('100');
    // DC sessions cap the power gauges at 250 kW (AC would be 22).
    expect(gauge('Peak Power').getAttribute('data-max')).toBe('250');
  });

  it('renders battery-progress read-outs and charge-summary inline metrics', () => {
    renderPage();

    // Start/End SoC bar sublabels come through fmtPercent at precision 2.
    expect(screen.getByText('20.00%')).toBeInTheDocument();
    expect(screen.getByText('80.00%')).toBeInTheDocument();
    // Energy Added restated via the injected energy formatter.
    expect(screen.getByText('50.0 kWh')).toBeInTheDocument();
    // Charge-summary inline metrics.
    expect(screen.getByText('100.00 kW')).toBeInTheDocument(); // Avg Power
    expect(screen.getByText('Complete')).toBeInTheDocument(); // Status
    expect(screen.getByText('USD')).toBeInTheDocument(); // Currency
  });

  it('renders the advanced live-charging KVList from the latest SI row', () => {
    renderPage();

    expect(kvValue('Charging State')).toBe('Charging');
    expect(kvValue('Charger Voltage')).toBe('240 V');
    expect(kvValue('Active Charge Current')).toBe('24.5 A');
    expect(kvValue('Pilot Current')).toBe('32.0 A');
    expect(kvValue('Phases')).toBe('3');
    // battery_range_mi is SI meters despite the suffix → 320 km.
    expect(kvValue('Battery Range')).toBe('320 km');
  });

  it('shows the range TOTAL for "Range Added" and the per-hour RATE for "Charge Rate" (regression)', () => {
    renderPage();

    // Charge Rate reads range_added_meters_per_hour (30000 m/h → 30.0 km/h).
    expect(kvValue('Charge Rate')).toBe('30.0 km/h');
    // Range Added reads the SI TOTAL range_added_meters (45000 m → 45.0 km),
    // converted ONCE — not the per-hour field with a spurious /1000 that
    // would have collapsed this to "0.0 km".
    expect(kvValue('Range Added')).toBe('45.0 km');
    expect(kvValue('Range Added')).not.toBe('0.0 km');
  });

  it('renders session info and both timestamp slots', () => {
    renderPage();

    expect(kvValue('Charger Type')).toBe('DC');
    expect(kvValue('Vehicle')).toBe('My Model 3');
    expect(screen.getByText('Started')).toBeInTheDocument();
    // A completed session has a real Ended timestamp, not the placeholder.
    const endedValue = screen.getByText('Ended').closest('p')?.nextElementSibling?.textContent ?? '';
    expect(endedValue).not.toBe('—');
  });

  it('does not tag the charge curve as estimated when real telemetry exists', () => {
    renderPage();
    expect(screen.getByText('Charge Curve')).toBeInTheDocument();
    expect(screen.queryByText('(estimated)')).toBeNull();
  });
});

describe('ChargingDetailPage — AC session without telemetry', () => {
  beforeEach(() => {
    mockSession.mockReturnValue(
      makeQuery({
        data: makeSession({
          charger_type: null, // → AC
          cost_decimal: null, // → estimated cost
          cost_currency: null,
          peak_power_w: 11_000,
          avg_power_w: 7_000,
        }),
      }),
    );
    mockTelemetry.mockReturnValue(makeQuery({ data: [] })); // no telemetry
  });

  it('uses the AC chip and the 22 kW gauge ceiling', () => {
    renderPage();
    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(within(summary).getByText('AC')).toBeInTheDocument();
    expect(gauge('Peak Power').getAttribute('data-max')).toBe('22');
  });

  it('flags the synthesized curve and shows the estimated-cost tile with rate hints', () => {
    renderPage();
    const kpi = kpiRegion();

    // No telemetry → the charge curve is synthesized and tagged estimated.
    expect(screen.getByText('(estimated)')).toBeInTheDocument();
    // cost_decimal null but energy present → Est. Cost via formatEnergyCost.
    expect(cardValue(kpi, 'Est. Cost')).toBe('$6.00'); // 50 kWh × $0.12
    expect(within(kpi).getByText('at $0.12/kWh')).toBeInTheDocument();
    // Per kWh falls back to the settings rate and is labelled as such.
    expect(cardValue(kpi, 'Per kWh')).toBe('$0.12/kWh');
    expect(within(kpi).getByText('from settings')).toBeInTheDocument();
  });

  it('shows a per-panel empty state for each time-axis chart that has no data', () => {
    renderPage();
    // SoC/Energy/Range, Temperature, and Voltage/Current all fall back.
    expect(screen.getAllByText('No data available').length).toBeGreaterThanOrEqual(3);
  });
});

describe('ChargingDetailPage — telemetry error isolation', () => {
  it('surfaces a Retry-able error in the time-axis panels while KPIs stay intact', () => {
    const refetch = vi.fn();
    mockTelemetry.mockReturnValue(
      makeQuery({ data: undefined, error: new ApiError('down', 500), isError: true, refetch }),
    );
    renderPage();

    // The KPI band still renders from the (independent) session query.
    expect(cardValue(kpiRegion(), 'Energy')).toBe('50.00 kWh');
    // Each of the three time-axis panels shows its own server-error banner.
    const serverErrors = screen.getAllByText('Server error');
    expect(serverErrors.length).toBe(3);
    // Retrying one panel calls the telemetry refetch.
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ChargingDetailPage — live-state branches', () => {
  it('renders loading skeletons in the advanced panel while the live query is pending', () => {
    mockLive.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByText('Advanced Charging Parameters')).toBeInTheDocument();
    // The KVList rows are withheld behind the skeletons.
    expect(screen.queryByText('Charger Voltage')).toBeNull();
    expect(screen.queryByText('No live charging telemetry available.')).toBeNull();
  });

  it('shows the advanced empty state and hides the live chip when there is no live row', () => {
    mockLive.mockReturnValue(makeQuery({ data: null }));
    renderPage();

    expect(screen.getByText('No live charging telemetry available.')).toBeInTheDocument();
    // Without a live row there is no charging-state chip in the summary.
    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(within(summary).queryByText('Charging')).toBeNull();
  });
});

describe('ChargingDetailPage — ongoing session', () => {
  it('collapses duration, blanks the Ended slot, and falls back for vehicle + location', () => {
    mockSession.mockReturnValue(
      makeQuery({ data: makeSession({ ended_at: null, start_place: null }) }),
    );
    mockVehicle.mockReturnValue(makeQuery({ data: undefined })); // vehicle not yet loaded
    mockLive.mockReturnValue(makeQuery({ data: null }));
    renderPage();

    // No ended_at → duration is 0 and the Ended slot is the em-dash.
    expect(cardValue(kpiRegion(), 'Duration')).toBe('0 min');
    const endedValue = screen.getByText('Ended').closest('p')?.nextElementSibling?.textContent ?? '';
    expect(endedValue).toBe('—');
    // Absent vehicle → "ID <vehicle_id>" fallback.
    expect(kvValue('Vehicle')).toBe('ID 7');
    // Placeless session → location empty state.
    expect(screen.getByText('No location recorded for this session.')).toBeInTheDocument();
  });
});
