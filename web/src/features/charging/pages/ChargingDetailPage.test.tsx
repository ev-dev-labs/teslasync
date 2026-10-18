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
 *   - ongoing session (no ended_at): duration remains unknown, the Ended slot
 *     renders the em-dash placeholder, an absent vehicle falls back to "ID N",
 *     and a placeless session shows the location empty state.
 *   - long sessions: small telemetry renders a full screen-reader table per
 *     chart; past the row cap the tables are omitted (no-table pattern) while
 *     all four charts still render every sample, each announcing a
 *     full-resolution summary instead.
 */
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import { fmtNumber } from '@/lib/numberFormat';
import type { ChargingSession, ChargeTelemetryReading, ChargingTelemetry } from '@/api/types';

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
}));

import { downloadCSV } from '@/lib/csvExport';

// ── i18n stub: resolve a string fallback (or the options-bag defaultValue) and
//    interpolate {{var}} placeholders so assertions read on human copy. ────────
const translations = vi.hoisted(() => new Map<string, string>());

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
    const translation = translations.get(key);
    if (translation != null) {
      return interpolate(translation, (
        typeof second === 'object' ? second : third
      ) as Record<string, unknown> | undefined);
    }
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
//    so we swap the plot primitives for inert passthroughs, keeping the real
//    EmbeddedChart frame to exercise its accessibility contract. LinearGauge surfaces
//    its label/value/max as data-* so gauge maths stays assertable. ───────────
vi.mock('@/components/charts', async () => {
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const { EmbeddedChart } = await import('@/components/charts/EmbeddedChart');
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ...chartTestDoubles,
    EmbeddedChart,
    LinearGauge: ({
      label,
      value,
      unit,
      max,
      color,
    }: {
      label?: string;
      value?: number | null;
      unit?: string;
      max?: number;
      color?: string;
    }) => (
      <div
        data-testid="gauge"
        data-label={label ?? ''}
        data-value={String(value)}
        data-unit={unit ?? ''}
        data-max={String(max)}
        data-color={color}
      />
    ),
    ResponsiveContainer: Passthrough,
    AreaChart: Passthrough,
    ComposedChart: Passthrough,
    Area: ({ dataKey, stroke, fillOpacity }: { dataKey: string; stroke: string; fillOpacity?: number }) =>
      <div data-testid="chart-series" data-key={dataKey} data-stroke={stroke} data-opacity={fillOpacity} />,
    Line: ({ dataKey, stroke }: { dataKey: string; stroke: string }) =>
      <div data-testid="chart-series" data-key={dataKey} data-stroke={stroke} />,
    XAxis: ({ label }: { label?: { value: string } }) =>
      <div data-testid="chart-axis" data-label={label?.value} />,
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

// The share dialog is covered by its own contract tests; here it only needs
// to prove the page wires open/close without firing share-list queries.
vi.mock('../components/ShareSessionDialog', () => ({
  ShareSessionDialog: ({
    sessionId,
    open,
    onClose,
  }: {
    sessionId: string
    open: boolean
    onClose: () => void
  }) =>
    open ? (
      <div role="dialog" aria-label="Share session" data-session-id={sessionId}>
        <button type="button" onClick={onClose}>
          close share dialog
        </button>
      </div>
    ) : null,
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
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: vi.fn() }));
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => ['var(--series-a)', 'var(--series-b)', 'var(--series-c)', 'var(--series-d)', 'var(--series-e)'],
}));

import { useChargingSessionDetail, useChargeTelemetry } from '@/api/hooks/useCharging';
import { useVehicle, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import * as settingsHooks from '@/hooks/useSettings';
import { formatDate, formatDateTime, formatTime } from '@/lib/dateFormat';
import ChargingDetailPage from './ChargingDetailPage';

const defaultSettingsResult = settingsHooks.useSettings();
const mockSettings = vi.spyOn(settingsHooks, 'useSettings');
const mockSession = useChargingSessionDetail as unknown as ReturnType<typeof vi.fn>;
const mockTelemetry = useChargeTelemetry as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useVehicle as unknown as ReturnType<typeof vi.fn>;
const mockLive = useChargingTelemetryLatest as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;
const mockFormatting = useFormatting as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}) {
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
    power_w: 120_000,
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
  makeReading({ created_at: '2024-03-10T08:05:00Z', battery_level: 30, power_w: 150_000 }),
  makeReading({ created_at: '2024-03-10T08:30:00Z', battery_level: 55, power_w: 110_000 }),
  makeReading({ created_at: '2024-03-10T08:55:00Z', battery_level: 79, power_w: 45_000 }),
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

const unitReturn = (distance: 'km' | 'mi' | 'ft' = 'km') => ({
  unitPrefs: {
    distance,
    speed: distance === 'mi' ? 'mph' : 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
  },
  formatEnergy: (wh: number | null | undefined) => `${(Number(wh ?? 0) / 1000).toFixed(2)} kWh`,
  formatDistance: (v: number) => String(v),
  formatSpeed: (v: number) => String(v),
  formatTemperature: (v: number) => String(v),
  formatPressure: (v: number) => String(v),
  formatDuration: (v: number) => String(v),
  formatPower: (w: number | null | undefined) => `${(Number(w ?? 0) / 1000).toFixed(2)} kW`,
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

const kpiRegion = () => {
  const container = document.getElementById('charging-detail-metrics');
  if (!container) throw new Error('Charging detail metrics container is missing');
  return within(container).getByRole('region', { name: 'Key metrics' });
};

/** Real OperationalBrief reading, selected by its retained source label. */
function cardValue(scope: HTMLElement, label: string): string {
  const tile = within(scope).getByText(label).closest('[data-operational-metric]');
  if (!tile) throw new Error(`Stat tile missing for ${label}`);
  return tile.querySelector('[data-operational-value]')?.textContent ?? '';
}

/** The named card owns its complete content, not just the heading's header. */
function namedCard(title: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title }).closest<HTMLElement>('[data-card]');
  if (!card) throw new Error(`Named card missing for ${title}`);
  return card;
}

/** Three distinct original session-distance presentations, not the live rate/total. */
function assertSessionDistances(expected: string) {
  if (expected === '—') {
    assertOperationalMetricUnavailable(kpiRegion(), 'Miles Added');
  } else {
    expect(cardValue(kpiRegion(), 'Miles Added')).toBe(expected);
  }
  const progressLabel = within(namedCard('Battery Progress')).getByText('Range Gained');
  expect(progressLabel.closest('p')?.nextElementSibling?.textContent).toBe(expected);
  const summaryLabel = within(namedCard('Charge Summary')).getByText('Miles Added');
  expect(summaryLabel.previousElementSibling?.textContent).toBe(expected);
}

/** The <dd> paired with a KVList <dt> label. */
function kvValue(label: string): string {
  const term = screen.getAllByText(label).find((element) => element.tagName === 'DT');
  return term?.closest('div')?.querySelector('dd')?.textContent ?? '';
}

/** The LinearGauge double carrying a given label. */
function gauge(label: string): HTMLElement {
  const el = screen.getAllByTestId('gauge').find((g) => g.getAttribute('data-label') === label);
  if (!el) throw new Error(`gauge not found: ${label}`);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  translations.clear();
  mockSettings.mockReturnValue(defaultSettingsResult);
  // Default happy-path wiring: a completed DC session with telemetry + live.
  mockUnits.mockReturnValue(unitReturn('km'));
  mockFormatting.mockReturnValue(formattingReturn());
  mockSession.mockReturnValue(makeQuery({ data: makeSession() }));
  mockTelemetry.mockReturnValue(makeQuery({ data: TELEMETRY }));
  mockVehicle.mockReturnValue(makeQuery({ data: VEHICLE }));
  mockLive.mockReturnValue(makeQuery({ data: makeLive() }));
});

describe('ChargingDetailPage — record-owned dates', () => {
  it('keeps dates and chart times in the record vehicle zone despite saved user preferences', () => {
    const locale = 'de-DE';
    const tz = 'America/Los_Angeles';
    const started_at = '2024-03-10T07:55:00Z';
    const ended_at = '2024-03-10T10:05:00Z';
    mockSettings.mockReturnValue({
      ...defaultSettingsResult,
      locale,
      settings: {
        ...defaultSettingsResult.settings,
        locale,
        tz_display_default: 'user',
        timezone_user: 'Asia/Tokyo',
      },
    });
    mockVehicle.mockReturnValue(makeQuery({ data: { ...VEHICLE, timezone: tz } }));
    mockSession.mockReturnValue(makeQuery({ data: makeSession({ started_at, ended_at }) }));
    mockTelemetry.mockReturnValue(makeQuery({
      data: [makeReading({ created_at: started_at })],
    }));
    renderPage();

    const started = screen.getByTitle(new Date(started_at).toISOString());
    const ended = screen.getByTitle(new Date(ended_at).toISOString());
    expect(started).toHaveTextContent(`${formatDateTime(started_at, { locale, tz })} (${tz})`);
    expect(ended).toHaveTextContent(`${formatDateTime(ended_at, { locale, tz })} (${tz})`);
    expect(screen.getAllByText((_, node) =>
      node?.textContent === formatTime(started_at, { locale, tz }),
    ).length).toBeGreaterThan(0);
    expect(screen.getByText((_, node) =>
      node?.tagName === 'P' && !!node.textContent?.startsWith(formatDate(started_at, { locale, tz })),
    )).toBeInTheDocument();
    expect(screen.queryByText(/Source timezone unresolved/)).not.toBeInTheDocument();
    expect(mockVehicle).toHaveBeenCalledWith('7');
  });

  it.each([
    ['missing', { ...VEHICLE }],
    ['invalid', { ...VEHICLE, timezone: 'Invalid/Zone' }],
    ['another vehicle', { ...VEHICLE, id: 8, timezone: 'Asia/Tokyo' }],
    ['unavailable', undefined],
  ])('discloses %s source timezone and retains UTC instants', (_, vehicle) => {
    mockVehicle.mockReturnValue(makeQuery({ data: vehicle }));
    renderPage();
    expect(screen.getByText('Source timezone unresolved; timestamps are shown in UTC.')).toBeInTheDocument();
    expect(screen.getByTitle('2024-03-10T08:00:00.000Z')).toHaveTextContent(
      `${formatDateTime('2024-03-10T08:00:00Z', { locale: 'en-US', tz: 'UTC' })} (UTC)`,
    );
  });

  it('treats an explicitly reported UTC vehicle timezone as resolved', () => {
    mockVehicle.mockReturnValue(makeQuery({ data: { ...VEHICLE, timezone: 'UTC' } }));
    renderPage();
    expect(screen.queryByText(/Source timezone unresolved/)).not.toBeInTheDocument();
    expect(screen.getByTitle('2024-03-10T08:00:00.000Z')).toHaveTextContent('(UTC)');
  });

  it.each(['not-a-date', ''])('renders placeholders without UTC hover values for %s dates', (started_at) => {
    mockVehicle.mockReturnValue(makeQuery({ data: { ...VEHICLE, timezone: 'Europe/Berlin' } }));
    mockSession.mockReturnValue(makeQuery({ data: makeSession({ started_at, ended_at: null }) }));
    renderPage();
    for (const label of ['Started', 'Ended']) {
      const timestamp = screen.getByText(label).nextElementSibling;
      expect(timestamp).toHaveTextContent('—');
      expect(timestamp?.querySelector('[title]')).toBeNull();
    }
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});

describe('ChargingDetailPage — loading', () => {
  it('renders the bento skeleton and withholds page content until the session resolves', () => {
    mockSession.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(screen.getByTestId('charging-detail-skeleton')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Charge Session', level: 1 }),
    ).toBeInTheDocument();
    // Populated-only readings stay absent; named source outlines remain visible.
    expect(screen.queryByRole('region', { name: 'Key metrics' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Live Gauges' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Battery Progress' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Charge Curve' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('gauge')).toHaveLength(0);
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

    const heading = screen.getByRole('heading', { name: 'Charge Session #42', level: 1 });
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    const header = heading.closest('header');
    if (!header) throw new Error('Charging session header is missing');
    const identity = within(header).getByText(/My Model 3/);
    expect(identity).toBeVisible();
    expect(identity.closest('[data-action-group="metadata"]')).not.toBeNull();
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
    expect(cardValue(kpi, 'Duration')).toBe('60.00 min');
    expect(cardValue(kpi, 'Peak Power')).toBe('150.00 kW');
    expect(cardValue(kpi, 'SoC Range')).toBe('20.00–80.00%');
    expect(cardValue(kpi, 'Total Cost')).toBe('12.50 USD');
    // 12.5 / (50000 Wh / 1000) = $0.25 per kWh.
    expect(cardValue(kpi, 'Per kWh')).toBe('0.25 USD/kWh');
    // 50 kWh over 60 min → 50 kWh/h.
    expect(cardValue(kpi, 'kWh/h Avg')).toBe('50.00 kWh/h');
    // No odometer delta on this session → em-dash, never NaN.
    assertOperationalMetricUnavailable(kpi, 'Miles Added');
  });

  it('prefers Tesla billed energy and cost on the KPI tiles without overwriting vehicle energy', () => {
    mockSession.mockReturnValue(
      makeQuery({
        data: makeSession({
          total_energy_added_wh: 42_620,
          cost_decimal: 20.88,
          billed_energy_wh: 44_490.6,
          billed_cost_decimal: 21.8,
          billed_currency: 'USD',
          billed_rate_per_kwh: 0.49,
          billed_source: 'tesla_charging_history',
        }),
      }),
    );
    renderPage();
    const kpi = kpiRegion();

    expect(cardValue(kpi, 'Energy')).toBe('44.49 kWh');
    expect(cardValue(kpi, 'Total Cost')).toBe('21.80 USD');
    expect(cardValue(kpi, 'Per kWh')).toBe('0.49 USD/kWh');
    fireEvent.click(within(kpi).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Key metrics details' });
    expect(within(details).getByText('Vehicle measured 42.62 kWh')).toBeInTheDocument();
    // Charge-summary restates vehicle energy, not the Supercharger bill.
    expect(within(namedCard('Battery Progress')).getByText('42.62 kWh')).toBeInTheDocument();
  });

  it.each([
    { name: 'session currency', overrides: { cost_currency: 'CAD' }, cost: '12.50 CAD', rate: '0.25 CAD/kWh' },
    { name: 'invoice currency', overrides: { billed_cost_decimal: 20, billed_currency: 'EUR' }, cost: '20.00 EUR', rate: '0.40 EUR/kWh' },
    { name: 'unknown session currency', overrides: { cost_currency: null }, cost: '12.50 —', rate: '0.25 —/kWh' },
    { name: 'unknown invoice currency', overrides: { billed_cost_decimal: 20, billed_currency: null }, cost: '20.00 —', rate: '0.40 —/kWh' },
    { name: 'zero invoice', overrides: { billed_cost_decimal: 0, billed_currency: 'CAD' }, cost: '0.00 CAD', rate: '0.00 CAD/kWh' },
    { name: 'refund', overrides: { cost_decimal: -12.5, cost_currency: 'CAD' }, cost: '-12.50 CAD', rate: '-0.25 CAD/kWh' },
  ])('retains $name without applying the configured symbol or exchange conversion', ({ overrides, cost, rate }) => {
    mockSession.mockReturnValue(makeQuery({ data: makeSession(overrides) }));
    mockFormatting.mockReturnValue({
      ...formattingReturn(),
      currencySymbol: 'kr',
      formatCurrency: (amount: number) => `kr${Number(amount).toFixed(2)}`,
    });
    renderPage();

    expect(cardValue(kpiRegion(), 'Total Cost')).toBe(cost);
    expect(cardValue(kpiRegion(), 'Per kWh')).toBe(rate);
  });

  it('retains the invoice denomination for a recorded standalone rate', () => {
    mockSession.mockReturnValue(makeQuery({
      data: makeSession({ cost_decimal: null, billed_rate_per_kwh: 0.49, billed_currency: 'CAD' }),
    }));
    renderPage();

    expect(cardValue(kpiRegion(), 'Per kWh')).toBe('0.49 CAD/kWh');
    expect(within(kpiRegion()).queryByText('from settings')).toBeNull();
    expect(cardValue(kpiRegion(), 'Est. Cost')).toBe('$6.00');
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Key metrics details' });
    expect(within(details).getByText('at $0.12/kWh')).toBeInTheDocument();
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
    expect(within(namedCard('Battery Progress')).getByText('50.00 kWh')).toBeInTheDocument();
    // Charge-summary inline metrics.
    expect(screen.getByText('100.00 kW')).toBeInTheDocument(); // Avg Power
    expect(screen.getByText('Complete')).toBeInTheDocument(); // Status
    expect(screen.getByText('USD')).toBeInTheDocument(); // Currency
  });

  it('renders the advanced live-charging KVList from the latest SI row', () => {
    renderPage();

    expect(kvValue('Charging State')).toBe('Charging');
    expect(kvValue('Charger Voltage')).toBe('240.00 V');
    expect(kvValue('Active Charge Current')).toBe('24.50 A');
    expect(kvValue('Pilot Current')).toBe('32.00 A');
    expect(kvValue('Charger Power')).toBe('11.00 kW');
    expect(kvValue('Energy Added')).toBe('12.00 kWh');
    expect(kvValue('Phases')).toBe('3');
    // battery_range_mi is SI meters despite the suffix → 320 km.
    expect(kvValue('Battery Range')).toBe('320.00 km');
  });

  it('shows the range TOTAL for "Range Added" and the per-hour RATE for "Charge Rate" (regression)', () => {
    renderPage();

    // Charge Rate reads range_added_meters_per_hour (30000 m/h → 30.0 km/h).
    expect(kvValue('Charge Rate')).toBe('30.00 km/h');
    // Range Added reads the SI TOTAL range_added_meters (45000 m → 45.0 km),
    // converted ONCE — not the per-hour field with a spurious /1000 that
    // would have collapsed this to "0.0 km".
    expect(kvValue('Range Added')).toBe('45.00 km');
    expect(kvValue('Range Added')).not.toBe('0.00 km');
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
    expect(screen.getByRole('heading', { name: 'Charge Curve' })).toBeInTheDocument();
    expect(screen.queryByText('(estimated)')).toBeNull();
  });

  it('keeps exactly one child-owned heading for each of the four populated plots', () => {
    renderPage();
    for (const title of [
      'Charge Curve', 'SoC, Energy & Range over Time', 'Temperature', 'Voltage & Current',
    ]) {
      // getByRole deliberately rejects duplicate outer/inner headings.
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('table')).toHaveLength(4);
  });
});

describe('ChargingDetailPage — corrected SI session-distance display boundary', () => {
  it.each([
    { unit: 'km' as const, expected: '50.00 km' },
    { unit: 'mi' as const, expected: '31.07 mi' },
    { unit: 'ft' as const, expected: '164,041.99 ft' },
  ])('converts the same positive 50000-meter delta once at all three $unit sites', ({ unit, expected }) => {
    mockUnits.mockReturnValue(unitReturn(unit));
    const source = makeSession({ start_odometer_m: 100000, end_odometer_m: 150000 });
    mockSession.mockReturnValue(makeQuery({ data: source }));
    renderPage();

    assertSessionDistances(expected);
    expect(source.start_odometer_m).toBe(100000);
    expect(source.end_odometer_m).toBe(150000);
    // This correction must not redefine the independent live total/rate sources.
    expect(mockTelemetry).toHaveBeenCalledWith(42);
    expect(mockLive).toHaveBeenCalledWith(7);
  });

  it.each([
    { name: 'missing start', start: null, end: 150000 },
    { name: 'missing end', start: 100000, end: null },
    { name: 'both missing', start: null, end: null },
  ])('retains the missing reading at all three sites for $name', ({ start, end }) => {
    mockSession.mockReturnValue(makeQuery({
      data: makeSession({ start_odometer_m: start, end_odometer_m: end }),
    }));
    renderPage();
    assertSessionDistances('—');
    // Existing live SI total/rate values remain independent of missing session delta.
    expect(kvValue('Range Added')).toBe('45.00 km');
    expect(kvValue('Charge Rate')).toBe('30.00 km/h');
  });

  it.each([
    { name: 'zero delta', start: 100000, end: 100000, expected: '0.00 km' },
    { name: 'negative delta', start: 150000, end: 100000, expected: '-50.00 km' },
  ])('preserves a measured $name at all three sites', ({ start, end, expected }) => {
    mockUnits.mockReturnValue(unitReturn('km'));
    mockSession.mockReturnValue(makeQuery({
      data: makeSession({ start_odometer_m: start, end_odometer_m: end }),
    }));
    renderPage();
    assertSessionDistances(expected);
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
    fireEvent.click(within(kpi).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Key metrics details' });
    expect(within(details).getByText('at $0.12/kWh')).toBeInTheDocument();
    // Per kWh falls back to the settings rate and is labelled as such.
    expect(cardValue(kpi, 'Per kWh')).toBe('$0.12/kWh');
    expect(within(details).getByText('from settings')).toBeInTheDocument();
  });

  it('shows a per-panel empty state for each time-axis chart that has no data', () => {
    renderPage();
    expect(
      screen.getAllByText('No battery level, energy, or range samples were recorded for this session.'),
    ).toHaveLength(2);
    expect(
      screen.getByText('No battery, cabin, or ambient temperature samples were recorded for this session.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No voltage or current samples were recorded for this session.'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/This closed session cannot recover missing samples/),
    ).toHaveLength(3);
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
    // The curve and all three time-axis panels expose the telemetry failure.
    const serverErrors = screen.getAllByText('Server error');
    expect(serverErrors.length).toBe(4);
    // Retrying one panel calls the telemetry refetch.
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ChargingDetailPage — curve provenance and specialist export', () => {
  it.each([
    { name: 'loading', query: { isLoading: true, isPending: true }, status: 'initial', provenance: 'unknown' },
    { name: 'failed', query: { error: new ApiError('down', 500), isError: true }, status: 'initialFailure', provenance: 'unknown' },
    { name: 'empty', query: { data: [] }, status: 'unavailable', provenance: 'historical' },
    { name: 'failed empty refresh', query: { data: [], error: new ApiError('down', 500), isError: true }, status: 'stale', provenance: 'historical' },
  ])('retains the labeled model while exporting the $name telemetry outcome and historical inputs', ({ query, status, provenance }) => {
    mockTelemetry.mockReturnValue(makeQuery(query));
    renderPage();

    const curveRegion = screen.getByRole('region', { name: 'Charge Curve' });
    expect(curveRegion).toHaveAttribute('data-curve-provenance', 'inferred');
    expect(curveRegion).toHaveAttribute('data-telemetry-status', status);
    expect(curveRegion).toHaveAttribute('data-telemetry-provenance', provenance);
    const curve = within(curveRegion);
    expect(curve.getByText('(estimated)')).toBeInTheDocument();
    expect(within(curve.getByTestId('charge-curve-inputs')).getByLabelText('Historical'))
      .toHaveAttribute('data-data-status', 'ok');
    expect(curve.getByRole('table', { name: 'Charge Curve — data table' }))
      .toBeInTheDocument();
    if (status === 'initialFailure') {
      expect(curve.getByText('Server error')).toBeInTheDocument();
    } else if (status === 'unavailable') {
      expect(curve.getByText('No battery level, energy, or range samples were recorded for this session.'))
        .toBeInTheDocument();
    } else if (status === 'stale') {
      expect(curve.getByText('Charge Curve may be out of date')).toBeInTheDocument();
      expect(curve.queryByText('No battery level, energy, or range samples were recorded for this session.'))
        .toBeNull();
    }

    fireEvent.click(curve.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    const csv = vi.mocked(downloadCSV).mock.lastCall?.[1];
    expect(csv).toContain('provenance,telemetry_status,telemetry_provenance,telemetry_sample_count,input_provenance,input_status');
    expect(csv).toContain(`inferred,${status},${provenance},0,historical,ok,20,80,150000,DC`);
  });

  it('exports retained measured samples as stale historical data after refresh failure, never as modeled', () => {
    mockTelemetry.mockReturnValue(makeQuery({ data: TELEMETRY, error: new ApiError('down', 500), isError: true }));
    renderPage();
    const curve = within(screen.getByRole('region', { name: 'Charge Curve' }));
    expect(curve.queryByText('(estimated)')).toBeNull();
    expect(curve.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'stale');
    fireEvent.click(curve.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    const csv = vi.mocked(downloadCSV).mock.lastCall?.[1];
    expect(csv).toContain('30,150,kW,historical,stale,historical,3,historical,stale');
    expect(csv).not.toContain('inferred');
    expect(csv).not.toContain('peak_power_w');
  });

  it('carries stale historical model inputs separately from unavailable telemetry', () => {
    mockSession.mockReturnValue(makeQuery({
      data: makeSession(),
      error: new ApiError('session refresh failed', 500),
      isError: true,
    }));
    mockTelemetry.mockReturnValue(makeQuery({ data: [] }));
    renderPage();

    const curve = within(screen.getByRole('region', { name: 'Charge Curve' }));
    expect(curve.getByText('(estimated)')).toBeInTheDocument();
    expect(curve.getByLabelText('Estimated')).toHaveAttribute('data-data-status', 'stale');
    expect(within(curve.getByTestId('charge-curve-inputs')).getByLabelText('Historical'))
      .toHaveAttribute('data-data-status', 'stale');
    fireEvent.click(curve.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(vi.mocked(downloadCSV).mock.lastCall?.[1])
      .toContain('inferred,unavailable,historical,0,historical,stale,20,80,150000,DC');
  });

  it('keeps populated measured exports historical with no modeled inputs', () => {
    renderPage();
    const curve = within(screen.getByRole('region', { name: 'Charge Curve' }));
    expect(curve.queryByText('(estimated)')).toBeNull();
    expect(curve.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
    fireEvent.click(curve.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    const csv = vi.mocked(downloadCSV).mock.lastCall?.[1];
    expect(csv).toContain('30,150,kW,historical,ok,historical,3,historical,ok');
    expect(csv).not.toContain('peak_power_w');
    expect(csv).not.toContain('inferred');
  });
});

describe('ChargingDetailPage — long-session fallback tables', () => {
  it('renders a full screen-reader table per chart for small telemetry', () => {
    renderPage();

    // 3 telemetry rows → all four chart frames tabulate every row.
    expect(screen.getAllByRole('table')).toHaveLength(4);
    const curve = screen.getByRole('table', { name: 'Charge Curve — data table' });
    expect(within(curve).getAllByRole('row')).toHaveLength(4);
    // Canonical watts are converted exactly once at the chart display boundary.
    expect(within(curve).getByRole('cell', { name: '150', exact: true })).toBeInTheDocument();
    expect(within(curve).queryByRole('cell', { name: '150000', exact: true })).toBeNull();
    expect(screen.queryByText(/Full-resolution data:/)).toBeNull();
  });

  it('omits the fallback tables but keeps every chart for very long sessions', () => {
    // 2,500 rows clears the 2,000-row table cap the way a 48-100h home
    // session (hundreds of thousands of rows) does: tabulating every row
    // would build millions of hidden DOM nodes and kill the tab.
    const bigTelemetry = Array.from({ length: 2500 }, (_, i) =>
      makeReading({
        created_at: `2024-03-${String(10 + Math.floor(i / 1440)).padStart(2, '0')}T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
        battery_level: 20 + (i % 70),
        power_w: 11_000 + (i % 5) * 1000,
      }),
    );
    mockTelemetry.mockReturnValue(makeQuery({ data: bigTelemetry }));
    renderPage();

    // No fallback table anywhere — but all four charts still render with
    // their full datasets (chart doubles are passthroughs; the headings
    // prove the panels took the populated branch, not an empty state).
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Charge Curve' })).toBeInTheDocument();
    // Each real chart owns exactly one semantic heading; visible labels are not
    // competing outer headings. These remain strict uniqueness assertions.
    expect(screen.getByRole('heading', { name: 'SoC, Energy & Range over Time' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Temperature' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Voltage & Current' })).toBeInTheDocument();
    // Each chart announces the honest full-data summary instead.
    const summaries = screen.getAllByText(/Full-resolution data:/);
    expect(summaries).toHaveLength(4);
    expect(summaries[0].textContent).toContain(fmtNumber(2500, 0));
    expect(summaries[0].textContent).toContain('every sample is drawn');
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
    expect(screen.getByText(/appear only while the selected vehicle is actively charging/)).toBeInTheDocument();
    // Without a live row there is no charging-state chip in the summary.
    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(within(summary).queryByText('Charging')).toBeNull();
  });
});

describe('ChargingDetailPage — ongoing session', () => {
  it('preserves unknown duration, blanks the Ended slot, and falls back for vehicle + location', () => {
    mockSession.mockReturnValue(
      makeQuery({ data: makeSession({ ended_at: null, start_place: null }) }),
    );
    mockVehicle.mockReturnValue(makeQuery({ data: undefined })); // vehicle not yet loaded
    mockLive.mockReturnValue(makeQuery({ data: null }));
    renderPage();

    // No ended_at leaves duration unknown rather than reporting measured zero.
    assertOperationalMetricUnavailable(kpiRegion(), 'Duration');
    const endedValue = screen.getByText('Ended').closest('p')?.nextElementSibling?.textContent ?? '';
    expect(endedValue).toBe('—');
    // Absent vehicle → "ID <vehicle_id>" fallback.
    expect(kvValue('Vehicle')).toBe('ID 7');
    // Placeless session → location empty state.
    expect(screen.getByText('No location recorded for this session.')).toBeInTheDocument();
  });
});

describe('ChargingDetailPage — localized identifier and duration', () => {
  it.each([false, true])('reuses existing translations with a populated vehicle: %s', populated => {
    translations.set('admin.vehicleCost.rowId', 'Kennung {{id}}');
    translations.set('common.min', 'Minuten');
    if (!populated) mockVehicle.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();

    expect(kvValue('Vehicle')).toBe(populated ? VEHICLE.display_name : 'Kennung 7');
    expect(gauge('Duration')).toHaveAttribute('data-unit', 'Minuten');
    expect(gauge('Duration')).toHaveAttribute('data-value', '60');
    expect(cardValue(kpiRegion(), 'Duration')).toBe('60.00 min');
    expect(cardValue(kpiRegion(), 'Energy')).toBe('50.00 kWh');
  });
});

describe('ChargingDetailPage — unrounded charging-rate denominator', () => {
  it.each([
    { seconds: 20, energy: 100, duration: '0.00 min', rate: '18.00 kWh/h' },
    { seconds: 20.5, energy: 102.5, duration: '0.00 min', rate: '18.00 kWh/h' },
    { seconds: 90, energy: 150, duration: '2.00 min', rate: '6.00 kWh/h' },
    { seconds: 20, energy: 0, duration: '0.00 min', rate: '0.00 kWh/h' },
    { seconds: 20, energy: -100, duration: '0.00 min', rate: '-18.00 kWh/h' },
  ])('uses $seconds seconds and source energy $energy without rounding the rate inputs', ({
    seconds, energy, duration, rate,
  }) => {
    const session = makeSession({
      ended_at: new Date(Date.parse('2024-03-10T08:00:00Z') + seconds * 1000).toISOString(),
      total_energy_added_wh: energy,
    });
    mockSession.mockReturnValue(makeQuery({ data: session }));
    renderPage();

    expect(cardValue(kpiRegion(), 'Duration')).toBe(duration);
    expect(cardValue(kpiRegion(), 'kWh/h Avg')).toBe(rate);
    expect(session.total_energy_added_wh).toBe(energy);
    expect(gauge('Energy Added')).toHaveAttribute('data-value', String(energy / 1000));
  });

  it.each([
    { name: 'missing end', fields: { ended_at: null } },
    { name: 'missing start', fields: { started_at: '' } },
    { name: 'invalid start', fields: { started_at: 'invalid' } },
    { name: 'invalid end', fields: { ended_at: 'invalid' } },
    { name: 'reversed interval', fields: { ended_at: '2024-03-10T07:59:59Z' } },
  ])('keeps duration and rate unknown for $name', ({ fields }) => {
    mockSession.mockReturnValue(makeQuery({ data: makeSession(fields) }));
    renderPage();

    assertOperationalMetricUnavailable(kpiRegion(), 'Duration');
    assertOperationalMetricUnavailable(kpiRegion(), 'kWh/h Avg');
    expect(gauge('Duration')).toHaveAttribute('data-value', 'null');
    expect(cardValue(kpiRegion(), 'Energy')).toBe('50.00 kWh');
  });

  it('preserves measured zero duration without dividing by zero', () => {
    mockSession.mockReturnValue(makeQuery({
      data: makeSession({ ended_at: '2024-03-10T08:00:00Z' }),
    }));
    renderPage();

    expect(cardValue(kpiRegion(), 'Duration')).toBe('0.00 min');
    expect(gauge('Duration')).toHaveAttribute('data-value', '0');
    assertOperationalMetricUnavailable(kpiRegion(), 'kWh/h Avg');
  });

  it.each([undefined, null, NaN, Infinity, -Infinity])(
    'does not turn missing or invalid source energy %s into a measured zero rate',
    energy => {
      const session = makeSession();
      Object.assign(session, { total_energy_added_wh: energy });
      mockSession.mockReturnValue(makeQuery({ data: session }));
      renderPage();

      assertOperationalMetricUnavailable(kpiRegion(), 'kWh/h Avg');
      expect(cardValue(kpiRegion(), 'Duration')).toBe('60.00 min');
      expect(session.total_energy_added_wh).toBe(energy);
    },
  );

  it('retains invoice-energy precedence without modifying vehicle energy for a short session', () => {
    const session = makeSession({
      ended_at: '2024-03-10T08:00:20Z',
      total_energy_added_wh: 100,
      billed_energy_wh: 125.5,
    });
    mockSession.mockReturnValue(makeQuery({ data: session }));
    renderPage();

    expect(cardValue(kpiRegion(), 'kWh/h Avg')).toBe('22.59 kWh/h');
    expect(session.total_energy_added_wh).toBe(100);
    expect(session.billed_energy_wh).toBe(125.5);
  });
});

describe('ChargingDetailPage — share dialog wiring', () => {
  function renderWithId() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter initialEntries={['/charging/42']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/charging/:id" element={<ChargingDetailPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('opens and closes the session share dialog from the header action', () => {
    renderWithId();

    expect(screen.queryByRole('dialog', { name: 'Share session' })).not.toBeInTheDocument();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share.closest('[data-action-group="overflow"]')).not.toBeNull();
    fireEvent.click(share);

    const dialog = screen.getByRole('dialog', { name: 'Share session' });
    expect(dialog).toHaveAttribute('data-session-id', '42');

    fireEvent.click(within(dialog).getByRole('button', { name: 'close share dialog' }));
    expect(screen.queryByRole('dialog', { name: 'Share session' })).not.toBeInTheDocument();
  });

  describe('ChargingDetailPage — restrained presentation and source honesty', () => {
    it('uses the saved palette for every preserved series and gauge without decorative area fill', () => {
      renderPage();

      expect(screen.getAllByTestId('chart-series').map(series => [
        series.getAttribute('data-key'), series.getAttribute('data-stroke'),
      ])).toEqual([
        ['power', 'var(--series-e)'],
        ['soc', 'var(--series-b)'],
        ['energy', 'var(--series-a)'],
        ['range', 'var(--series-c)'],
        ['battery', 'var(--series-d)'],
        ['inside', 'var(--series-c)'],
        ['outside', 'var(--series-a)'],
        ['voltage', 'var(--series-c)'],
        ['current', 'var(--series-a)'],
      ]);
      expect(gauge('Energy Added')).toHaveAttribute('data-color', 'var(--series-a)');
      expect(gauge('Peak Power')).toHaveAttribute('data-color', 'var(--series-e)');
      for (const series of screen.getAllByTestId('chart-series').filter(el =>
        ['power', 'soc'].includes(el.getAttribute('data-key') ?? ''),
      )) {
        expect(series).toHaveAttribute('data-opacity', '0.08');
      }
      expect(screen.getAllByTestId('chart-axis')[0]).toHaveAttribute('data-label', 'SoC %');
      expect(screen.getAllByRole('table')).toHaveLength(4);
    });

    it('keeps missing battery and power readings unknown while all five gauges and section shells remain', () => {
      mockSession.mockReturnValue(makeQuery({
        data: makeSession({ start_soc_pct: null, end_soc_pct: null, peak_power_w: null, avg_power_w: null }),
      }));
      renderPage();

      expect(screen.getAllByTestId('gauge')).toHaveLength(5);
      for (const label of ['End SoC', 'Peak Power', 'Avg Power']) {
        expect(gauge(label)).toHaveAttribute('data-value', 'null');
      }
      const progress = within(namedCard('Battery Progress'));
      for (const label of ['Start SoC', 'End SoC']) {
        expect(progress.getByRole('progressbar', { name: label })).not.toHaveAttribute('aria-valuenow');
        expect(progress.getByRole('progressbar', { name: label })).toHaveAttribute('aria-valuetext', 'No reading');
      }
      expect(progress.getByText('SoC Gained').closest('p')?.nextElementSibling?.textContent).toBe('—');
      expect(screen.getByRole('heading', { name: 'Charge Summary' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Advanced Charging Parameters' })).toBeInTheDocument();
    });

    it('preserves measured zero independently from an unknown duration for an ongoing record', () => {
      mockSession.mockReturnValue(makeQuery({
        data: makeSession({ ended_at: null, end_soc_pct: 0, peak_power_w: 0, avg_power_w: 0 }),
      }));
      renderPage();

      for (const label of ['End SoC', 'Peak Power', 'Avg Power']) {
        expect(gauge(label)).toHaveAttribute('data-value', '0');
      }
      expect(gauge('Duration')).toHaveAttribute('data-value', 'null');
      expect(within(namedCard('Battery Progress')).getByRole('progressbar', { name: 'End SoC' }))
        .toHaveAttribute('aria-valuenow', '0');
    });

    it.each([
      { name: 'missing start', fields: { start_soc_pct: null } },
      { name: 'missing end', fields: { end_soc_pct: null } },
      { name: 'missing peak', fields: { peak_power_w: null } },
      { name: 'nonfinite peak', fields: { peak_power_w: Infinity } },
      { name: 'reversed interval', fields: { start_soc_pct: 90, end_soc_pct: 20 } },
    ])('does not invent model inputs for $name', ({ fields }) => {
      mockSession.mockReturnValue(makeQuery({ data: makeSession(fields) }));
      mockTelemetry.mockReturnValue(makeQuery({ data: [] }));
      renderPage();

      expect(screen.getByRole('region', { name: 'Charge Curve' })).toBeInTheDocument();
      expect(screen.getByText(/A charge curve cannot be plotted/)).toBeInTheDocument();
      expect(screen.queryByRole('table', { name: 'Charge Curve — data table' })).toBeNull();
      expect(screen.queryByText('(estimated)')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Charge Summary' })).toBeInTheDocument();
    });

    it('keeps the explicit AC classification and the complete inferred model separate from measured telemetry', () => {
      mockSession.mockReturnValue(makeQuery({ data: makeSession({ charger_type: 'AC', peak_power_w: 11_000 }) }));
      mockTelemetry.mockReturnValue(makeQuery({ data: [] }));
      renderPage();

      expect(within(screen.getByRole('region', { name: 'Session summary' })).getAllByText('AC')).toHaveLength(2);
      expect(gauge('Peak Power')).toHaveAttribute('data-max', '22');
      expect(screen.getByText('(estimated)')).toBeInTheDocument();
      expect(screen.getByText('Estimated').closest('[data-provenance]'))
        .toHaveAttribute('title', 'Derived from other readings. The vehicle did not report this value directly.');
      expect(within(screen.getByRole('table', { name: 'Charge Curve — data table' })).getAllByRole('row')).toHaveLength(22);
    });

    it('qualifies current vehicle state without changing the historical session status or record-owned queries', () => {
      renderPage();

      const summary = within(screen.getByRole('region', { name: 'Session summary' }));
      expect(summary.getByText('Latest reported values from the vehicle.')).toBeInTheDocument();
      expect(summary.getByText('Charging')).toBeInTheDocument();
      expect(within(namedCard('Charge Summary')).getByText('Complete')).toBeInTheDocument();
      expect(mockTelemetry).toHaveBeenCalledWith(42);
      expect(mockLive).toHaveBeenCalledWith(7);
    });
  });
});
