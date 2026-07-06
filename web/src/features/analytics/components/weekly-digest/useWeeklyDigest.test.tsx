// useWeeklyDigest hook tests.
//
// This hook is the data brain behind the Weekly Digest page: it selects a
// vehicle, fetches drives / charging / alerts, slices them into the Monday–
// Sunday window for the active `weekOffset`, and derives every KPI, chart
// series, and fun-fact the page renders. The suite covers the full public
// surface returned by the hook:
//
//   • vehicle selection      — vehicleOptions mapping (display_name → vin
//                              fallback), default selectedVehicleId, setVehicleId
//                              re-scoping the domain queries.
//   • request wiring          — snake_case `vehicle_id` params, no `/api/v1`
//                              prefix, `/alerts` fired without a vehicle param.
//   • week-scoped metrics     — sums / averages / co2 / battery deltas for the
//                              current week, previous-week comparison values,
//                              and topDrive selection.
//   • chart series            — Mon…Sun daily distance + energy bins, alert pie
//                              slices incl. the CHART_COLORS fallback colour.
//   • fun fact                — nearest-city-pair narration + the <10 km guard.
//   • navigation              — goToPrevWeek / goToNextWeek offset arithmetic and
//                              the "can't step into the future" guard.
//   • per-domain async state  — independent error channels + refetch callbacks
//                              and the aggregate refetchAll fan-out.
//   • hardening (regression)  — a malformed row (NaN / undefined numeric fields)
//                              is coerced to 0 instead of poisoning an aggregate
//                              into NaN, and the empty-fleet path leaves the
//                              domain queries idle.
//
// Network is stubbed at the request() boundary (the module useWeeklyDigest AND
// the real useVehicles hook both import from). Week fixtures are anchored to the
// live getWeekRange() output so assertions are deterministic on any weekday.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/components/charts';
import { ALERT_SEVERITY_COLORS } from './constants';
import { getWeekRange } from './helpers';
import { useWeeklyDigest } from './useWeeklyDigest';
import type { Drive, ChargingSession, Alert } from './types';
import type { Vehicle } from '@/types/vehicle';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/* ── Wrapper ── */
function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

/** Lets a disabled query settle so we can assert it never fired. */
const tick = () => new Promise((r) => setTimeout(r, 10));

/* ── Fixture builders ── */
function makeVehicle(over: Partial<Vehicle> & Pick<Vehicle, 'id' | 'vin'>): Vehicle {
  return {
    vehicle_id: over.id,
    display_name: `Vehicle ${over.id}`,
    model: 'model3',
    trim_badging: 'p',
    exterior_color: 'black',
    wheel_type: 'aero',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  };
}

/** ISO instant at 12:00 local, `dayOffset` days after `base` (a week Monday). */
function atNoon(base: Date, dayOffset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function makeDrive(over: Partial<Drive> & Pick<Drive, 'id' | 'start_date'>): Drive {
  return {
    distance: 0,
    duration_min: 0,
    efficiency_wh_km: 0,
    energy_used: 0,
    ...over,
  };
}

function makeCharge(
  over: Partial<ChargingSession> & Pick<ChargingSession, 'id' | 'start_ts'>,
): ChargingSession {
  return {
    total_energy_added_wh: 0,
    cost: 0,
    duration_min: 0,
    start_battery_pct: 0,
    end_battery_pct: 0,
    ...over,
  };
}

const DEFAULT_VEHICLES: Vehicle[] = [
  makeVehicle({ id: 1, vin: 'VIN1', display_name: 'Model 3' }),
  makeVehicle({ id: 2, vin: 'VIN2', display_name: '' }), // empty name → vin fallback
];

interface DataConfig {
  vehicles?: Vehicle[];
  drives?: Drive[] | Error;
  charging?: ChargingSession[] | Error;
  alerts?: Alert[] | Error;
}

function settle<T>(value: T | Error): Promise<T> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
}

function installRoutes(cfg: DataConfig = {}) {
  const vehicles = cfg.vehicles ?? DEFAULT_VEHICLES;
  mockedRequest.mockImplementation((url: string) => {
    if (url === '/vehicles') return Promise.resolve(vehicles);
    if (url.startsWith('/drives')) return settle(cfg.drives ?? []);
    if (url.startsWith('/charging')) return settle(cfg.charging ?? []);
    if (url.startsWith('/alerts')) return settle(cfg.alerts ?? []);
    return Promise.resolve([]);
  });
}

const urlsCalled = () =>
  mockedRequest.mock.calls.map(([u]) => u).filter((u): u is string => typeof u === 'string');
const callsFor = (prefix: string) => urlsCalled().filter((u) => u.startsWith(prefix)).length;

/* ── A representative fully-populated week ── */
function seedFullWeek() {
  const [curStart] = getWeekRange(0);
  const [prevStart] = getWeekRange(-1);

  const drives: Drive[] = [
    // current week
    makeDrive({ id: 1, start_date: atNoon(curStart, 0), distance: 100, duration_min: 60, efficiency_wh_km: 200, energy_used: 20 }),
    makeDrive({ id: 2, start_date: atNoon(curStart, 2), distance: 50, duration_min: 30, efficiency_wh_km: 180, energy_used: 10 }),
    // previous week
    makeDrive({ id: 3, start_date: atNoon(prevStart, 1), distance: 60, duration_min: 40, efficiency_wh_km: 210, energy_used: 12 }),
  ];
  const charging: ChargingSession[] = [
    makeCharge({ id: 1, start_ts: atNoon(curStart, 0), total_energy_added_wh: 10000, cost: 5, duration_min: 60, start_battery_pct: 20, end_battery_pct: 80 }),
    makeCharge({ id: 2, start_ts: atNoon(curStart, 1), total_energy_added_wh: 5000, cost: 2.5, duration_min: 30, start_battery_pct: 50, end_battery_pct: 90 }),
    makeCharge({ id: 3, start_ts: atNoon(prevStart, 2), total_energy_added_wh: 8000, cost: 4, duration_min: 50, start_battery_pct: 30, end_battery_pct: 70 }),
  ];
  const alerts: Alert[] = [
    { id: 1, severity: 'info', created_at: atNoon(curStart, 0) },
    { id: 2, severity: 'warning', created_at: atNoon(curStart, 1) },
    { id: 3, severity: 'critical', created_at: atNoon(curStart, 2) },
    { id: 4, severity: 'info', created_at: atNoon(prevStart, 0) }, // prev week — excluded
  ];
  return { drives, charging, alerts };
}

beforeAll(() => {
  // funFact narration formats via fmtNumber(times, 1); pin locale/precision so
  // the expected magnitude string is deterministic regardless of CI defaults.
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

beforeEach(() => {
  mockedRequest.mockReset();
});

/* ── Vehicle selection ── */
describe('vehicle selection', () => {
  it('maps vehicles to Select options, falling back to VIN when display_name is empty', async () => {
    installRoutes();
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.vehicleOptions).toHaveLength(2));
    expect(result.current.vehicleOptions).toEqual([
      { value: '1', label: 'Model 3' },
      { value: '2', label: 'VIN2' },
    ]);
    // Defaults to the first vehicle's id.
    expect(result.current.selectedVehicleId).toBe('1');
  });

  it('re-scopes the drive/charging queries when setVehicleId switches vehicle', async () => {
    installRoutes();
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(callsFor('/drives?vehicle_id=1')).toBe(1));

    act(() => result.current.setVehicleId('2'));

    await waitFor(() =>
      expect(urlsCalled()).toContain('/drives?vehicle_id=2'),
    );
    expect(result.current.selectedVehicleId).toBe('2');
    expect(urlsCalled()).toContain('/charging?vehicle_id=2');
  });
});

/* ── Request wiring ── */
describe('request wiring', () => {
  it('fetches drives + charging with snake_case vehicle_id and alerts unscoped, no /api/v1 prefix', async () => {
    installRoutes();
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => {
      const u = urlsCalled();
      expect(u).toContain('/drives?vehicle_id=1');
      expect(u).toContain('/charging?vehicle_id=1');
      expect(u).toContain('/alerts'); // alerts endpoint is not vehicle-scoped
    });

    const urls = urlsCalled();
    expect(urls).toContain('/vehicles');
    // The vehicle_id in the drive/charge URLs is the derived default selection.
    expect(result.current.selectedVehicleId).toBe('1');
    // No hook may double-prefix; the client injects /api/v1 itself.
    expect(urls.some((u) => u.includes('/api/v1'))).toBe(false);
  });

  it('keeps the domain queries idle until a vehicle id resolves (empty fleet)', async () => {
    installRoutes({ vehicles: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(callsFor('/vehicles')).toBe(1));
    await tick();

    expect(result.current.vehicleOptions).toEqual([]);
    expect(result.current.selectedVehicleId).toBe('');
    expect(result.current.hasData).toBe(false);
    expect(callsFor('/drives')).toBe(0);
    expect(callsFor('/charging')).toBe(0);
    expect(result.current.metrics.totalDistance).toBe(0);
  });
});

/* ── Week-scoped metrics ── */
describe('aggregated metrics', () => {
  it('sums the current week and exposes previous-week comparison values', async () => {
    const { drives, charging, alerts } = seedFullWeek();
    installRoutes({ drives, charging, alerts });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.metrics.totalDrives).toBe(2));
    const m = result.current.metrics;

    // Drives (current week: 100 + 50).
    expect(m.totalDistance).toBe(150);
    expect(m.energyUsed).toBe(30);
    expect(m.totalDuration).toBe(90);
    expect(m.avgEfficiency).toBe(190); // (200 + 180) / 2
    expect(m.co2Saved).toBeCloseTo(6.3, 5); // 30 * 0.21
    expect(m.topDrive?.id).toBe(1); // the 100 km drive wins

    // Previous week comparison (a single 60 km drive).
    expect(m.prevDistance).toBe(60);
    expect(m.prevDriveCount).toBe(1);
    expect(m.prevEnergy).toBe(12);

    // Charging (current week: two sessions).
    expect(m.chargingSessionCount).toBe(2);
    expect(m.chargeEnergyAdded).toBe(15000);
    expect(m.chargingCost).toBe(7.5);
    expect(m.avgChargeRate).toBe(10000); // both sessions == 10000 Wh/h
    expect(m.batteryStart).toBe(35); // (20 + 50) / 2
    expect(m.batteryEnd).toBe(85); // (80 + 90) / 2
    expect(m.prevChargeEnergy).toBe(8000);

    // Alerts (prev-week info alert excluded).
    expect(m.alertTotal).toBe(3);
    expect(m.alertsByType).toEqual({ info: 1, warning: 1, critical: 1 });

    expect(result.current.hasData).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeFalsy();
  });

  it('reports zeroed metrics without NaN or divide-by-zero on an empty week', async () => {
    installRoutes({ drives: [], charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(callsFor('/drives')).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const m = result.current.metrics;

    expect(m.totalDistance).toBe(0);
    expect(m.avgEfficiency).toBe(0);
    expect(m.avgChargeRate).toBe(0);
    expect(m.batteryStart).toBe(0);
    expect(m.topDrive).toBeUndefined();
    expect(Number.isNaN(m.avgEfficiency)).toBe(false);
    expect(result.current.hasData).toBe(false);
  });
});

/* ── Hardening / regression ── */
describe('malformed-row hardening', () => {
  it('coerces NaN / undefined numeric fields to 0 instead of poisoning the aggregate', async () => {
    const [curStart] = getWeekRange(0);
    const good = makeDrive({ id: 1, start_date: atNoon(curStart, 0), distance: 100, duration_min: 60, efficiency_wh_km: 200, energy_used: 20 });
    // A partial telemetry row: typed `number`, but the values are missing.
    const bad = {
      id: 2,
      start_date: atNoon(curStart, 3),
      distance: NaN,
      duration_min: undefined,
      efficiency_wh_km: NaN,
      energy_used: undefined,
    } as unknown as Drive;

    installRoutes({ drives: [good, bad], charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.metrics.totalDrives).toBe(2));
    const m = result.current.metrics;

    expect(Number.isNaN(m.totalDistance)).toBe(false);
    expect(m.totalDistance).toBe(100); // 100 + safeNumber(NaN)
    expect(m.energyUsed).toBe(20); // 20 + safeNumber(undefined)
    expect(m.totalDuration).toBe(60);
    expect(m.avgEfficiency).toBe(100); // (200 + 0) / 2
    // The Thursday bin for the malformed drive stays a real number, not NaN.
    expect(result.current.dailyDistanceData[3].distance).toBe(0);
  });
});

/* ── Chart series ── */
describe('chart series', () => {
  it('bins drives and charging into a Mon…Sun daily series', async () => {
    const { drives, charging } = seedFullWeek();
    installRoutes({ drives, charging, alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.metrics.totalDrives).toBe(2));

    const dist = result.current.dailyDistanceData;
    expect(dist).toHaveLength(7);
    expect(dist.map((b) => b.day)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(dist[0].distance).toBe(100); // Monday drive
    expect(dist[2].distance).toBe(50); // Wednesday drive
    expect(dist[4].distance).toBe(0); // Friday empty

    const energy = result.current.dailyEnergyData;
    expect(energy[0].energy).toBe(10000); // Monday charge
    expect(energy[1].energy).toBe(5000); // Tuesday charge
    expect(energy[6].energy).toBe(0); // Sunday empty
  });

  it('builds alert pie slices with severity colours and a CHART_COLORS fallback', async () => {
    const [curStart] = getWeekRange(0);
    const alerts: Alert[] = [
      { id: 1, severity: 'warning', created_at: atNoon(curStart, 0) },
      { id: 2, severity: 'mystery', created_at: atNoon(curStart, 1) }, // unknown severity
    ];
    installRoutes({ drives: [], charging: [], alerts });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.alertPieData).toHaveLength(2));
    const pie = result.current.alertPieData;

    const warning = pie.find((p) => p.name === 'Warning');
    expect(warning).toMatchObject({ value: 1, color: ALERT_SEVERITY_COLORS.warning });

    const mystery = pie.find((p) => p.name === 'Mystery');
    expect(mystery?.value).toBe(1);
    expect(mystery?.color).toBe(CHART_COLORS[4]); // fallback colour for unmapped severity
  });
});

/* ── Fun fact ── */
describe('fun fact', () => {
  it('narrates the nearest city pair for the weekly distance', async () => {
    const { drives } = seedFullWeek();
    installRoutes({ drives, charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    // 150 km snaps to the shortest known leg (New York → Boston, 350 km).
    await waitFor(() => expect(result.current.funFact).toBeDefined());
    expect(result.current.funFact).toEqual({
      from: 'New York',
      to: 'Boston',
      times: '0.4', // fmtNumber(150 / 350, 1)
    });
  });

  it('suppresses the fun fact below the 10 km floor', async () => {
    const [curStart] = getWeekRange(0);
    installRoutes({
      drives: [makeDrive({ id: 1, start_date: atNoon(curStart, 0), distance: 3 })],
      charging: [],
      alerts: [],
    });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.metrics.totalDistance).toBe(3));
    expect(result.current.funFact).toBeUndefined();
  });
});

/* ── Navigation ── */
describe('week navigation', () => {
  it('steps back a week, re-slices to the previous window, and steps forward again', async () => {
    const { drives, charging, alerts } = seedFullWeek();
    installRoutes({ drives, charging, alerts });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.metrics.totalDistance).toBe(150));
    expect(result.current.isCurrentWeek).toBe(true);
    const currentLabel = result.current.weekLabel;
    expect(currentLabel).toContain('–');

    act(() => result.current.goToPrevWeek());
    await waitFor(() => expect(result.current.metrics.totalDistance).toBe(60));
    expect(result.current.isCurrentWeek).toBe(false);
    expect(result.current.weekLabel).not.toBe(currentLabel);

    act(() => result.current.goToNextWeek());
    await waitFor(() => expect(result.current.metrics.totalDistance).toBe(150));
    expect(result.current.isCurrentWeek).toBe(true);
  });

  it('refuses to step into the future from the current week', async () => {
    installRoutes({ drives: [], charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isCurrentWeek).toBe(true));
    const label = result.current.weekLabel;

    act(() => result.current.goToNextWeek());
    await tick();

    expect(result.current.isCurrentWeek).toBe(true);
    expect(result.current.weekLabel).toBe(label); // unchanged — no forward step
  });
});

/* ── Per-domain async state ── */
describe('per-domain loading / error state', () => {
  it('surfaces a drive error independently while charging + alerts still succeed', async () => {
    installRoutes({ drives: new Error('drives boom'), charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.drivesError).toBeTruthy());
    expect((result.current.drivesError as Error).message).toBe('drives boom');
    expect(result.current.chargingError).toBeFalsy();
    expect(result.current.alertsError).toBeFalsy();
    // The aggregate error channel reflects the failing domain.
    expect(result.current.error).toBeTruthy();
    expect(typeof result.current.refetchDrives).toBe('function');
  });

  it('exposes three freshness queries and a refetchAll that re-fires every domain', async () => {
    installRoutes({ drives: [], charging: [], alerts: [] });
    const { result } = renderHook(() => useWeeklyDigest(), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(callsFor('/drives')).toBeGreaterThan(0);
      expect(callsFor('/charging')).toBeGreaterThan(0);
      expect(callsFor('/alerts')).toBeGreaterThan(0);
    });
    expect(result.current.freshnessQueries).toHaveLength(3);

    const drivesBefore = callsFor('/drives');
    const chargingBefore = callsFor('/charging');
    const alertsBefore = callsFor('/alerts');

    act(() => result.current.refetchAll());

    await waitFor(() => expect(callsFor('/drives')).toBeGreaterThan(drivesBefore));
    expect(callsFor('/charging')).toBeGreaterThan(chargingBefore);
    expect(callsFor('/alerts')).toBeGreaterThan(alertsBefore);
  });
});
