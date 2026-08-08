/**
 * SafetySettingsPage — pure-helper branch coverage + page orchestration.
 *
 * Two surfaces are exercised:
 *
 *   1. The module-private helpers exported for testability (mirrors the
 *      SpeedProfilePage / DrivetrainHealthPage convention): `isAebEnabled`
 *      (the inverted `off=false → enabled` rule), `scoreColor` /
 *      `scoreBadgeVariant` (the 80 / 50 threshold bands incl. boundaries),
 *      `boolFeatures` / `enabledCount` (the 9-feature bag + the AEB
 *      default-on edge), `toChartData` (ascending sort + bool→0/1 mapping)
 *      and `buildFeatureCards` (the real safetyEnum prefix-stripping running
 *      through `cleanSafetyEnum` / `isSafetyEnumActive`).
 *
 *   2. The page's OWN behaviour: the KPI band, the safety-score gauge, the
 *      live security-signal tiles (incl. the null → "—" placeholder), the
 *      ADAS feature grid, the driving-stats cards (with the genuine
 *      `convertDistanceFromSI` SI→display conversion for both km and mi),
 *      the states-over-time chart derivation, and the history table — plus
 *      the no-vehicle / loading / error(+retry) / empty postures for every
 *      data source and the refresh-all toolbar wiring.
 *
 * A regression guard is included for the KPI-band null-data bug: when the
 * safety query succeeds with `null` data the band used to render misleading
 * "0% / 9 disabled" MetricCards; it must now show the shared empty state
 * like every other section.
 *
 * Strategy (mirrors ./../../driving/pages/SpeedProfilePage.test.tsx):
 *   - The three data hooks + the vehicle selector + useUnits are mocked with
 *     hoisted vi.fn()s so the network is never touched and each render is
 *     deterministic. The REAL `convertDistanceFromSI` + `fmtInt` / `fmtNumber`
 *     + `cleanSafetyEnum` run, so the derivations are genuinely exercised.
 *   - `@/components/charts` is stubbed so the recharts internals (which need a
 *     measured container jsdom can't provide) don't render; the LineChart stub
 *     captures the exact derived `data`, and the LinearGauge stub prints its
 *     value/max/unit for assertions.
 *   - The VehicleSelect toolbar control is stubbed via React.createElement
 *     (keeps jsx-a11y off the mock markup).
 *   - react-i18next resolves the developer fallback string, interpolating
 *     `{{vars}}`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SafetySnapshot } from '@/types/vehicle-systems';
import type { SecurityEvent } from '@/api/types';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + PageContainer + the
// DataFreshness chip's useMotionPreference read it at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const {
  safetyMock,
  safetyHistoryMock,
  securityMock,
  unitsMock,
  selectedVehicleMock,
  latestRefetch,
  historyRefetch,
  securityRefetch,
  captured,
  UNIT_PREFS_KM,
  UNIT_PREFS_MI,
} = vi.hoisted(() => ({
  safetyMock: vi.fn(),
  safetyHistoryMock: vi.fn(),
  securityMock: vi.fn(),
  unitsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  latestRefetch: vi.fn(),
  historyRefetch: vi.fn(),
  securityRefetch: vi.fn(),
  captured: {} as Record<string, unknown>,
  UNIT_PREFS_KM: {
    distance: 'km',
    speed: 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: undefined,
  },
  UNIT_PREFS_MI: {
    distance: 'mi',
    speed: 'mph',
    temperature: '°F',
    pressure: 'psi',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: undefined,
  },
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Drive the data hooks deterministically without any network.
vi.mock('@/api/hooks/useVehicleSystems', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useVehicleSystems')>(
      '@/api/hooks/useVehicleSystems',
    );
  return {
    ...actual,
    useSafety: (...args: unknown[]) => safetyMock(...args),
    useSafetyHistory: (...args: unknown[]) => safetyHistoryMock(...args),
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return {
    ...actual,
    useSecurityLatest: (...args: unknown[]) => securityMock(...args),
  };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => selectedVehicleMock() }));

// Stub the toolbar vehicle picker. createElement (not JSX) keeps jsx-a11y off.
vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: function VehicleSelectStub() {
      return React.createElement('div', { 'data-testid': 'vehicle-select' });
    },
  };
});

// Stub the chart primitives: recharts needs a measured container jsdom can't
// give it. LineChart captures the exact derived `data`; LinearGauge prints
// value/max/unit; everything else is inert.
vi.mock('@/components/charts', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const Null = () => null;
  const Pass = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    LinearGauge: function LinearGauge({
      value,
      max,
      unit,
      label,
    }: {
      value: number;
      max: number;
      unit?: string;
      label?: string;
    }) {
      return React.createElement(
        'div',
        { 'data-testid': 'linear-gauge', 'data-label': label },
        `${value}/${max} ${unit ?? ''}`,
      );
    },
    LineChart: function LineChart({ data, children }: { data?: unknown; children?: ReactNode }) {
      captured.lineChartData = data;
      return React.createElement('div', { 'data-testid': 'line-chart' }, children);
    },
    ResponsiveContainer: Pass,
    Line: Null,
    XAxis: Null,
    YAxis: Null,
    Tooltip: Null,
    Legend: Null,
    ChartTooltip: Null,
    chartGrid: null,
    axisTick: {},
    chartMargin: {},
    CHART_COLORS: ['#00f0ff', '#10b981', '#f59e0b'],
    AREA_DEFAULTS: {},
  };
});

import SafetySettingsPage, {
  isAebEnabled,
  boolFeatures,
  enabledCount,
  scoreColor,
  scoreBadgeVariant,
  toChartData,
  buildFeatureCards,
  TOTAL_FEATURES,
} from './SafetySettingsPage';

/* ── Fixtures ─────────────────────────────────────────────────────── */

function makeQuery<T>(
  overrides: { data?: T | null; isLoading?: boolean; error?: unknown; refetch?: () => void } = {},
) {
  return {
    data: overrides.data as T,
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    isStale: false,
    isError: overrides.error != null,
    error: overrides.error ?? null,
    dataUpdatedAt: Date.now(),
    refetch: overrides.refetch ?? vi.fn(),
  };
}

function makeSecurity(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 42,
    ts: '2024-06-15T12:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: null,
    sentry_mode: null,
    user_present: null,
    detail: null,
    source: 'telemetry',
    created_at: '2024-06-15T12:00:00Z',
    ...overrides,
  };
}

// A latest snapshot with a deterministic 6-of-9 enabled mix:
//   aeb (off=false → ON), bsc ON, elda ON, fcw ON, lda ON, cfd ON  → 6
//   bscw OFF, ptd OFF, slw OFF (SpeedAssistLevelNone)              → 3 disabled
const SAFETY: SafetySnapshot = {
  id: 1,
  vehicle_id: 42,
  automatic_emergency_braking_off: false,
  automatic_blind_spot_camera: true,
  blind_spot_collision_warning: false,
  emergency_lane_departure_avoidance: true,
  pin_to_drive_enabled: false,
  forward_collision_warning: 'ForwardCollisionSensitivityHigh',
  lane_departure_avoidance: 'LaneAssistLevelWarning',
  speed_limit_warning: 'SpeedAssistLevelNone',
  cruise_follow_distance: 'FollowDistance3',
  miles_since_reset: 12000, // meters (SI) → 12 km / 7.46 mi
  self_driving_miles_since_reset: 3000, // meters (SI) → 3 km / 1.86 mi
  created_at: '2024-06-15T12:00:00Z',
};

const SECURITY: SecurityEvent = makeSecurity({
  driver_seat_belt: true, // Buckled
  passenger_seat_belt: false, // Unbuckled
  driver_seat_occupied: true, // Occupied
  locked: true, // Locked
});

// Two history rows with opposite AEB/BSCW/ELDA states so the ascending
// chart mapping is unambiguous.
const HISTORY: SafetySnapshot[] = [
  {
    id: 10,
    created_at: '2024-06-15T12:00:00Z',
    automatic_emergency_braking_off: false, // aeb → 1
    blind_spot_collision_warning: true, // bscw → 1
    emergency_lane_departure_avoidance: false, // elda → 0
    forward_collision_warning: 'ForwardCollisionSensitivityHigh',
  },
  {
    id: 11,
    created_at: '2024-06-14T12:00:00Z',
    automatic_emergency_braking_off: true, // aeb → 0
    blind_spot_collision_warning: false, // bscw → 0
    emergency_lane_departure_avoidance: true, // elda → 1
    forward_collision_warning: false,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SafetySettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];

  safetyMock.mockReturnValue(makeQuery<SafetySnapshot>({ data: SAFETY, refetch: latestRefetch }));
  safetyHistoryMock.mockReturnValue(
    makeQuery<SafetySnapshot[]>({ data: HISTORY, refetch: historyRefetch }),
  );
  securityMock.mockReturnValue(makeQuery<SecurityEvent>({ data: SECURITY, refetch: securityRefetch }));
  unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_KM });
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
});

/* ── Specs: pure helpers ──────────────────────────────────────────── */

describe('SafetySettingsPage helpers', () => {
  it('isAebEnabled inverts the `off` flag (off=false ⇒ enabled)', () => {
    expect(isAebEnabled(false)).toBe(true);
    expect(isAebEnabled(true)).toBe(false);
  });

  it('scoreColor applies the 80 / 50 threshold bands incl. boundaries', () => {
    expect(scoreColor(80)).toBe('#10b981'); // ≥80 green
    expect(scoreColor(79.9)).toBe('#f59e0b'); // just under 80 → amber
    expect(scoreColor(50)).toBe('#f59e0b'); // ≥50 amber
    expect(scoreColor(49.9)).toBe('#ef4444'); // under 50 → red
  });

  it('scoreBadgeVariant mirrors the same bands', () => {
    expect(scoreBadgeVariant(80)).toBe('success');
    expect(scoreBadgeVariant(50)).toBe('warning');
    expect(scoreBadgeVariant(49)).toBe('danger');
  });

  it('boolFeatures / enabledCount count all nine features and honour the AEB default-on', () => {
    const flags = boolFeatures(SAFETY);
    expect(flags).toHaveLength(TOTAL_FEATURES);
    expect(flags.filter(Boolean)).toHaveLength(6);
    expect(enabledCount(SAFETY)).toBe(6);
    // An all-missing snapshot still counts AEB as enabled (off defaults false).
    expect(enabledCount({})).toBe(1);
  });

  it('toChartData sorts ascending by created_at and maps booleans to 0/1', () => {
    const points = toChartData(HISTORY);
    expect(points).toHaveLength(2);
    // Ascending: 06-14 (aeb off) then 06-15 (aeb on).
    expect(points.map((p) => p.aeb)).toEqual([0, 1]);
    expect(points.map((p) => p.bscw)).toEqual([0, 1]);
    expect(points.map((p) => p.elda)).toEqual([1, 0]);
  });

  it('buildFeatureCards funnels raw enum values through the real safetyEnum cleaner', () => {
    const cards = buildFeatureCards(SAFETY, (k) => k);
    expect(cards).toHaveLength(TOTAL_FEATURES);
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
    expect(byKey.aeb.enabled).toBe(true);
    expect(byKey.fcw.valueText).toBe('High'); // prefix stripped
    expect(byKey.slw.enabled).toBe(false); // SpeedAssistLevelNone → Off
    expect(byKey.cfd.valueText).toBe('3'); // FollowDistance3 → "3"
  });
});

/* ── Specs: page render / orchestration ───────────────────────────── */

describe('SafetySettingsPage', () => {
  it('prompts for a vehicle in every section when none is selected', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Safety Settings' }),
    ).toBeInTheDocument();
    // Seven placeholder panels (KPI, gauge, live signals, ADAS, stats, chart, table).
    expect(
      screen.getAllByText('Select a vehicle to view its safety settings.'),
    ).toHaveLength(7);
    // No data-driven content leaked through.
    expect(screen.queryByText('67%')).not.toBeInTheDocument();
    expect(screen.queryByTestId('linear-gauge')).not.toBeInTheDocument();
  });

  it('renders the KPI band + gauge from the derived safety score', () => {
    renderPage();

    const kpi = screen.getByRole('region', { name: 'Safety summary' });
    expect(within(kpi).getByText('Safety Score')).toBeInTheDocument();
    expect(within(kpi).getByText('67%')).toBeInTheDocument(); // 6/9 → 66.7 → 67
    expect(within(kpi).getByText('Total Features')).toBeInTheDocument();
    expect(within(kpi).getByText('9')).toBeInTheDocument();
    expect(within(kpi).getByText('Enabled')).toBeInTheDocument();
    expect(within(kpi).getByText('6')).toBeInTheDocument();
    expect(within(kpi).getByText('Disabled')).toBeInTheDocument();
    expect(within(kpi).getByText('3')).toBeInTheDocument();

    const overview = screen.getByRole('region', { name: 'Safety overview' });
    // The ring counts enabled features against the total; the percentage is a
    // derived summary and belongs on the badge, not smuggled through the gauge's
    // `unit` slot (which rendered "6 67%" and captioned the scale as "0 – 967%").
    expect(within(overview).getByTestId('linear-gauge')).toHaveTextContent('6/9');
    expect(within(overview).getByText('6/9 enabled · 67%')).toBeInTheDocument();
  });

  it('renders live security signals and falls back to "—" for unknown values', () => {
    renderPage();
    const overview = screen.getByRole('region', { name: 'Safety overview' });

    expect(within(overview).getByText('Driver Belt')).toBeInTheDocument();
    expect(within(overview).getByText('Buckled')).toBeInTheDocument();
    expect(within(overview).getByText('Passenger Belt')).toBeInTheDocument();
    expect(within(overview).getByText('Unbuckled')).toBeInTheDocument();
    expect(within(overview).getByText('Occupied')).toBeInTheDocument();
    expect(within(overview).getByText('Locked')).toBeInTheDocument();

    // When the security snapshot is absent, every tile shows the "—" placeholder.
    securityMock.mockReturnValue(makeQuery<SecurityEvent>({ data: null }));
    renderPage();
    const overview2 = screen.getAllByRole('region', { name: 'Safety overview' })[1];
    expect(within(overview2).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(overview2).queryByText('Buckled')).not.toBeInTheDocument();
  });

  it('renders the ADAS grid + driving stats with SI→km converted distances', () => {
    renderPage();
    const features = screen.getByRole('region', {
      name: 'ADAS features and driving statistics',
    });

    expect(within(features).getByText('Auto Emergency Braking')).toBeInTheDocument();
    expect(within(features).getByText('Forward Collision Warning')).toBeInTheDocument();
    expect(within(features).getByText('High')).toBeInTheDocument(); // fcw value

    expect(within(features).getByText('Distance Since Reset')).toBeInTheDocument();
    expect(within(features).getByText('12.00')).toBeInTheDocument(); // 12000 m → 12 km
    expect(within(features).getByText('Self-Driving Distance')).toBeInTheDocument();
    expect(within(features).getByText('3.00')).toBeInTheDocument(); // 3000 m → 3 km
  });

  it('re-converts driving-stat distances when unit prefs switch to mi', () => {
    unitsMock.mockReturnValue({ unitPrefs: UNIT_PREFS_MI });
    renderPage();
    const features = screen.getByRole('region', {
      name: 'ADAS features and driving statistics',
    });

    expect(within(features).getByText('7.46')).toBeInTheDocument(); // 12000 m → 7.46 mi
    expect(within(features).getByText('1.86')).toBeInTheDocument(); // 3000 m → 1.86 mi
    expect(within(features).getByText('mi (autopilot)')).toBeInTheDocument(); // {{unit}} interp
  });

  it('feeds the ascending chart derivation to the LineChart + labels it for a11y', () => {
    renderPage();

    expect(
      screen.getByRole('img', { name: 'Safety feature states over time' }),
    ).toBeInTheDocument();
    const data = captured.lineChartData as Array<{ aeb: number; bscw: number; elda: number }>;
    expect(data).toHaveLength(2);
    expect(data.map((p) => p.aeb)).toEqual([0, 1]);
    expect(data.map((p) => p.elda)).toEqual([1, 0]);
  });

  it('renders the history table with column headers and no empty state', () => {
    renderPage();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('AEB')).toBeInTheDocument(); // table column header
    expect(screen.queryByText('No history records found.')).not.toBeInTheDocument();
  });

  it('shows skeleton scaffolding (not data or empty states) while loading', () => {
    safetyMock.mockReturnValue(makeQuery<SafetySnapshot>({ isLoading: true }));
    safetyHistoryMock.mockReturnValue(makeQuery<SafetySnapshot[]>({ isLoading: true }));
    securityMock.mockReturnValue(makeQuery<SecurityEvent>({ isLoading: true }));
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Safety Settings' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Total Features')).not.toBeInTheDocument();
    expect(screen.queryByTestId('linear-gauge')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Select a vehicle to view its safety settings.'),
    ).not.toBeInTheDocument();
    expect(captured.lineChartData).toBeUndefined();
  });

  it('surfaces safety-query errors with a working retry affordance', () => {
    safetyMock.mockReturnValue(
      makeQuery<SafetySnapshot>({ error: new Error('boom'), refetch: latestRefetch }),
    );
    renderPage();

    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Total Features')).not.toBeInTheDocument();

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(retries[0]);
    expect(latestRefetch).toHaveBeenCalled();
  });

  it('shows the empty state (never misleading zeros) when safety data is null', () => {
    safetyMock.mockReturnValue(makeQuery<SafetySnapshot>({ data: null }));
    renderPage();

    // The fix: the KPI band AND the gauge both show the shared "no data" state.
    expect(
      screen.getAllByText('No safety data available for this vehicle.'),
    ).toHaveLength(2);
    // The misleading "0% / 9 disabled" MetricCards are gone.
    expect(screen.queryByText('Total Features')).not.toBeInTheDocument();
    expect(screen.queryByText('67%')).not.toBeInTheDocument();
    // Dependent sections keep their own tailored placeholders.
    expect(
      screen.getByText('No ADAS feature data available for this vehicle.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No driving statistics available for this vehicle.'),
    ).toBeInTheDocument();
  });

  it('shows chart + table empty states when there is no history', () => {
    safetyHistoryMock.mockReturnValue(makeQuery<SafetySnapshot[]>({ data: [] }));
    renderPage();

    expect(screen.getByText('No safety state history to chart yet.')).toBeInTheDocument();
    expect(screen.getByText('No history records found.')).toBeInTheDocument();
    expect(captured.lineChartData).toBeUndefined();
  });

  it('refreshes every data source from the toolbar refresh button', () => {
    renderPage();

    // Both the page's real <button> and the freshness chip expose the name
    // "Refresh"; the refresh-all wiring lives on the real <button>.
    const pageRefresh = screen
      .getAllByRole('button', { name: 'Refresh' })
      .find((el) => el.tagName === 'BUTTON');
    expect(pageRefresh).toBeDefined();

    fireEvent.click(pageRefresh!);
    expect(latestRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(securityRefetch).toHaveBeenCalledTimes(1);
  });
});
