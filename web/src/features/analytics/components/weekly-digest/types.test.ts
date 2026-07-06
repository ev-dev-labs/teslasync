/**
 * weekly-digest/types — the view-model contract, locked at its boundaries.
 *
 * `types.ts` exports nine interfaces and no runtime values, so — exactly like
 * the `devtools/types.test.ts` precedent — the only honest way to lock them is
 * to pin the contract where it is actually produced and consumed:
 *
 *   producer → `useWeeklyDigest()` is the SOLE factory for the derived shapes
 *              ({@link DigestMetrics}, {@link DailyDistanceEntry},
 *              {@link DailyEnergyEntry}, {@link AlertPieEntry}, {@link FunFact}).
 *              Given the per-record inputs, its output MUST structurally satisfy
 *              those interfaces AND carry the correct aggregate values.
 *   inputs   → {@link Drive} / {@link ChargingSession} / {@link Alert} are the
 *              per-record shapes the hook reads; the fixtures below are typed
 *              against them, so a field rename/removal in types.ts breaks this
 *              file at compile time.
 *
 * Each `assert*Shape` guard takes its interface type as a parameter (compile-time
 * pin) and asserts every field is present with the right runtime type (runtime
 * pin) — so a wire-shape drift or a producer regression can't slip past unseen.
 *
 * Strategy: network is mocked at the `request` boundary (the repo convention —
 * see api/hooks/useTrips.test.tsx). Week bucketing is made deterministic by
 * deriving every fixture timestamp from the hook's own `getWeekRange` helper, so
 * "this week" / "last week" placement is correct in any timezone and never races
 * the wall clock. The global test-setup stubs useSettings / useTimezone /
 * observers, so fmtNumber uses the en-US locale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// jsdom lacks matchMedia; install a benign stub before the shared UI barrel that
// useWeeklyDigest pulls in (via @/components/charts) can read it at import time.
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

// Keep every real client export and swap only the HTTP entry point for a spy.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import { useWeeklyDigest } from './useWeeklyDigest';
import { getWeekRange, dayOfWeekIndex } from './helpers';
import { DAY_LABELS, CO2_PER_KWH_GASOLINE_KG, ALERT_SEVERITY_COLORS } from './constants';
import type {
  Drive,
  ChargingSession,
  Alert,
  DigestMetrics,
  FunFact,
  DailyDistanceEntry,
  DailyEnergyEntry,
  AlertPieEntry,
} from './types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Interface shape guards (compile-time + runtime pins) ─────────────────────

function assertDriveShape(d: Drive): void {
  expect(typeof d.id).toBe('number');
  expect(typeof d.start_date).toBe('string');
  expect(typeof d.distance).toBe('number');
  expect(typeof d.duration_min).toBe('number');
  expect(typeof d.efficiency_wh_km).toBe('number');
  expect(typeof d.energy_used).toBe('number');
}

function assertChargingSessionShape(c: ChargingSession): void {
  expect(typeof c.id).toBe('number');
  expect(typeof c.start_ts).toBe('string');
  expect(typeof c.total_energy_added_wh).toBe('number');
  expect(typeof c.cost).toBe('number');
  expect(typeof c.duration_min).toBe('number');
  expect(typeof c.start_battery_pct).toBe('number');
  expect(typeof c.end_battery_pct).toBe('number');
}

function assertAlertShape(a: Alert): void {
  expect(typeof a.id).toBe('number');
  expect(typeof a.severity).toBe('string');
  expect(typeof a.created_at).toBe('string');
}

function assertDigestMetricsShape(m: DigestMetrics): void {
  const numericKeys: Array<keyof DigestMetrics> = [
    'totalDistance', 'prevDistance', 'totalDrives', 'prevDriveCount',
    'energyUsed', 'prevEnergy', 'chargingCost', 'prevChargingCost',
    'co2Saved', 'prevCo2', 'avgEfficiency', 'prevAvgEfficiency',
    'totalDuration', 'chargeEnergyAdded', 'prevChargeEnergy', 'avgChargeRate',
    'chargingSessionCount', 'batteryStart', 'batteryEnd', 'alertTotal',
  ];
  for (const key of numericKeys) {
    expect(typeof m[key]).toBe('number');
    expect(Number.isNaN(m[key] as number)).toBe(false);
  }
  expect(typeof m.alertsByType).toBe('object');
  expect(m.alertsByType).not.toBeNull();
  // topDrive is the one optional field: undefined, or a well-formed Drive.
  if (m.topDrive !== undefined) assertDriveShape(m.topDrive);
}

function assertFunFactShape(f: FunFact): void {
  expect(typeof f.from).toBe('string');
  expect(typeof f.to).toBe('string');
  expect(typeof f.times).toBe('string');
}

function assertDailyDistanceEntryShape(e: DailyDistanceEntry): void {
  expect(typeof e.day).toBe('string');
  expect(typeof e.distance).toBe('number');
}

function assertDailyEnergyEntryShape(e: DailyEnergyEntry): void {
  expect(typeof e.day).toBe('string');
  expect(typeof e.energy).toBe('number');
}

function assertAlertPieEntryShape(e: AlertPieEntry): void {
  expect(typeof e.name).toBe('string');
  expect(typeof e.value).toBe('number');
  expect(typeof e.color).toBe('string');
}

// ── Deterministic, timezone-safe fixtures ────────────────────────────────────
//
// Derive instants from the hook's own getWeekRange so "this week" / "last week"
// placement matches whatever the hook computes at render time, in any TZ.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface WeekAnchors {
  thisMon: string; // Monday of the current week (index 0)
  thisWed: string; // Wednesday of the current week (index 2)
  lastWeek: string; // some day inside the previous week
  longAgo: string; // well outside both weeks
}

function weekAnchors(): WeekAnchors {
  const [ws] = getWeekRange(0); // Monday 00:00 local of the current week
  const [ps] = getWeekRange(-1); // Monday 00:00 local of the previous week
  return {
    thisMon: new Date(ws.getTime() + HOUR_MS).toISOString(),
    thisWed: new Date(ws.getTime() + 2 * DAY_MS + HOUR_MS).toISOString(),
    lastWeek: new Date(ps.getTime() + DAY_MS).toISOString(),
    longAgo: '2000-01-01T00:00:00.000Z',
  };
}

interface Network {
  vehicles?: unknown;
  drives?: unknown;
  charging?: unknown;
  alerts?: unknown;
}

const VEHICLE = { id: 7, display_name: 'Model 3', vin: '5YJ3E1EA1NF000007' };

/** Route the mocked request() by path, mirroring the four hook queries. */
function primeNetwork(net: Network): void {
  mockedRequest.mockImplementation((url: string) => {
    if (url === '/vehicles') return Promise.resolve(net.vehicles ?? [VEHICLE]);
    if (url.startsWith('/drives')) return Promise.resolve(net.drives ?? []);
    if (url.startsWith('/charging')) return Promise.resolve(net.charging ?? []);
    if (url.startsWith('/alerts')) return Promise.resolve(net.alerts ?? []);
    return Promise.resolve([]);
  });
}

function renderDigest() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderHook(() => useWeeklyDigest(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children),
  });
}

/**
 * A representative week: two drives / two charge sessions / three alerts inside
 * the current week (Mon + Wed), plus one of each in the prior week and one drive
 * far in the past. Drives are ordered [50 km, 100 km] so the top-drive reducer
 * has to pick the LATER, larger record — not merely the first.
 */
function populatedNetwork(a: WeekAnchors): Network {
  const drives: Drive[] = [
    { id: 2, start_date: a.thisWed, distance: 50, duration_min: 30, efficiency_wh_km: 200, energy_used: 10 },
    { id: 1, start_date: a.thisMon, distance: 100, duration_min: 60, efficiency_wh_km: 150, energy_used: 15 },
    { id: 3, start_date: a.lastWeek, distance: 80, duration_min: 40, efficiency_wh_km: 180, energy_used: 12 },
    { id: 4, start_date: a.longAgo, distance: 999, duration_min: 99, efficiency_wh_km: 999, energy_used: 99 },
  ];
  const charging: ChargingSession[] = [
    { id: 11, start_ts: a.thisMon, total_energy_added_wh: 20, cost: 5, duration_min: 60, start_battery_pct: 20, end_battery_pct: 60 },
    { id: 12, start_ts: a.thisWed, total_energy_added_wh: 30, cost: 8, duration_min: 30, start_battery_pct: 40, end_battery_pct: 80 },
    { id: 13, start_ts: a.lastWeek, total_energy_added_wh: 10, cost: 3, duration_min: 20, start_battery_pct: 10, end_battery_pct: 30 },
  ];
  const alerts: Alert[] = [
    { id: 21, severity: 'warning', created_at: a.thisMon },
    { id: 22, severity: 'warning', created_at: a.thisWed },
    { id: 23, severity: 'critical', created_at: a.thisMon },
    { id: 24, severity: 'info', created_at: a.lastWeek }, // prior week → excluded
  ];
  return { drives, charging, alerts };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('input DTO contracts (Drive / ChargingSession / Alert)', () => {
  it('the fixtures the hook consumes structurally satisfy every input interface', () => {
    const a = weekAnchors();
    const net = populatedNetwork(a);
    (net.drives as Drive[]).forEach(assertDriveShape);
    (net.charging as ChargingSession[]).forEach(assertChargingSessionShape);
    (net.alerts as Alert[]).forEach(assertAlertShape);
    // Sanity: the fixtures actually carry the identifiers the assertions read.
    expect((net.drives as Drive[])).toHaveLength(4);
    expect((net.alerts as Alert[]).map((x) => x.severity)).toContain('critical');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWeeklyDigest → DigestMetrics (the derived aggregate contract)', () => {
  it('derives every metric for the current week and pins the week-over-week baselines', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => {
      expect(result.current.metrics.totalDrives).toBe(2);
      expect(result.current.metrics.chargingSessionCount).toBe(2);
      expect(result.current.metrics.alertTotal).toBe(3);
    });

    const m = result.current.metrics;
    assertDigestMetricsShape(m);

    // Distance / drives / energy for THIS week (drives 1 + 2).
    expect(m.totalDistance).toBe(150);
    expect(m.energyUsed).toBe(25);
    expect(m.totalDuration).toBe(90);
    // Efficiency is the simple mean of the two per-drive efficiencies.
    expect(m.avgEfficiency).toBeCloseTo(175, 6);
    // CO₂ scales linearly with energy via the shared constant.
    expect(m.co2Saved).toBeCloseTo(25 * CO2_PER_KWH_GASOLINE_KG, 6);

    // Prior-week baselines (drive 3 / session 13) — never mixed with this week.
    expect(m.prevDistance).toBe(80);
    expect(m.prevDriveCount).toBe(1);
    expect(m.prevEnergy).toBe(12);
    expect(m.prevAvgEfficiency).toBeCloseTo(180, 6);
    expect(m.prevChargingCost).toBe(3);
    expect(m.prevChargeEnergy).toBe(10);

    // Charging aggregates.
    expect(m.chargingCost).toBe(13);
    expect(m.chargeEnergyAdded).toBe(50);
    expect(m.batteryStart).toBeCloseTo(30, 6); // (20 + 40) / 2
    expect(m.batteryEnd).toBeCloseTo(70, 6); // (60 + 80) / 2
    // Rate = mean of (energy / minutes * 60): (20 + 60) / 2.
    expect(m.avgChargeRate).toBeCloseTo(40, 5);
  });

  it('selects the longest drive of the week as topDrive (max by distance, not first seen)', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.metrics.topDrive).toBeDefined());

    const top = result.current.metrics.topDrive;
    expect(top).toBeDefined();
    assertDriveShape(top as Drive);
    // Drive #1 (100 km) is second in the input array but must win over #2 (50 km).
    expect(top?.id).toBe(1);
    expect(top?.distance).toBe(100);
  });

  it('buckets alerts by severity and totals them (prior-week alerts excluded)', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.metrics.alertTotal).toBe(3));

    // Two warnings + one critical this week; the prior-week `info` is dropped.
    expect(result.current.metrics.alertsByType).toEqual({ warning: 2, critical: 1 });
    expect(result.current.metrics.alertsByType.info).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWeeklyDigest → chart series (Daily* + AlertPieEntry contracts)', () => {
  it('emits a seven-day distance/energy series bucketed onto the correct weekday', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.metrics.totalDistance).toBe(150));

    const { dailyDistanceData, dailyEnergyData } = result.current;
    // Exactly one bucket per weekday label, in DAY_LABELS order.
    expect(dailyDistanceData).toHaveLength(7);
    expect(dailyEnergyData).toHaveLength(7);
    expect(dailyDistanceData.map((e) => e.day)).toEqual([...DAY_LABELS]);
    dailyDistanceData.forEach(assertDailyDistanceEntryShape);
    dailyEnergyData.forEach(assertDailyEnergyEntryShape);

    const monIdx = dayOfWeekIndex(a.thisMon); // 0
    const wedIdx = dayOfWeekIndex(a.thisWed); // 2
    expect(dailyDistanceData[monIdx].distance).toBe(100);
    expect(dailyDistanceData[wedIdx].distance).toBe(50);
    expect(dailyEnergyData[monIdx].energy).toBe(20);
    expect(dailyEnergyData[wedIdx].energy).toBe(30);
    // Series total reconciles with the aggregate metric.
    expect(dailyDistanceData.reduce((s, e) => s + e.distance, 0)).toBe(150);
    expect(dailyEnergyData.reduce((s, e) => s + e.energy, 0)).toBe(50);
  });

  it('maps alert buckets to labelled, coloured pie slices via ALERT_SEVERITY_COLORS', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.alertPieData).toHaveLength(2));

    const pie = result.current.alertPieData;
    pie.forEach(assertAlertPieEntryShape);
    expect(pie).toEqual([
      { name: 'Warning', value: 2, color: ALERT_SEVERITY_COLORS.warning },
      { name: 'Critical', value: 1, color: ALERT_SEVERITY_COLORS.critical },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWeeklyDigest → FunFact (the optional headline contract)', () => {
  it('produces a formatted city-pair headline once the week clears the distance floor', async () => {
    const a = weekAnchors();
    primeNetwork(populatedNetwork(a));
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.funFact).toBeDefined());

    const fact = result.current.funFact as FunFact;
    assertFunFactShape(fact);
    // 150 km → nearest CITY_PAIRS entry is New York→Boston (350 km); 150/350≈0.4.
    expect(fact.from).toBe('New York');
    expect(fact.to).toBe('Boston');
    expect(fact.times).toBe('0.4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useWeeklyDigest — empty + null-safety guards', () => {
  it('zeroes every derived shape (no NaN, no crash) when all feeds are empty', async () => {
    primeNetwork({ vehicles: [VEHICLE], drives: [], charging: [], alerts: [] });
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const m = result.current.metrics;
    assertDigestMetricsShape(m); // includes the "no NaN" invariant
    expect(m.totalDistance).toBe(0);
    expect(m.chargingSessionCount).toBe(0);
    expect(m.alertTotal).toBe(0);
    expect(m.topDrive).toBeUndefined();
    expect(m.alertsByType).toEqual({});

    // Chart series stay well-formed (seven zeroed distance/energy buckets).
    expect(result.current.dailyDistanceData).toHaveLength(7);
    expect(result.current.dailyDistanceData.every((e) => e.distance === 0)).toBe(true);
    expect(result.current.alertPieData).toEqual([]);
    // Below the 10 km floor → no headline.
    expect(result.current.funFact).toBeUndefined();
    expect(result.current.hasData).toBe(false);
  });

  it('survives Go nil-slice bodies (JSON null) via the `?? []` guards', async () => {
    // Vehicles present so the domain queries fire, but each returns null.
    primeNetwork({ vehicles: [VEHICLE], drives: null, charging: null, alerts: null });
    const { result } = renderDigest();

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const m = result.current.metrics;
    assertDigestMetricsShape(m);
    expect(m.totalDrives).toBe(0);
    expect(m.chargeEnergyAdded).toBe(0);
    expect(m.alertTotal).toBe(0);
    expect(result.current.dailyEnergyData).toHaveLength(7);
    expect(result.current.hasData).toBe(false);
  });
});
