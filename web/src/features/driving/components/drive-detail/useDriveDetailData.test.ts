/**
 * useDriveDetailData — the Drive Detail page's single data/derivation hook.
 *
 * This is the one non-presentational unit in the drive-detail stack: it joins
 * `useDrive` + `useVehicle`, then derives the route trail, the speed-coloured
 * map segments, the per-sample `ChartDataPoint[]`, the aggregate `DriveStats`,
 * and the speed histogram that every sibling panel/chart consumes. There is no
 * DOM here, so the elevation brief's user-interaction/a11y facets don't apply —
 * instead every derived output is exercised for the facets that matter for a
 * derivation hook: SI→display unit conversion (metric AND imperial branches),
 * telemetry-vs-positions source selection, null/0 filtering, the stat fallback
 * formulas, and the memoisation contract.
 *
 * Strategy: the four direct hook dependencies (`useDrive`, `useVehicle`,
 * `useUnits`, `useDateFormat`) are mocked through a hoisted holder so each test
 * controls loading/error/data, the active unit preference, and a deterministic
 * `formatTime`. The REAL `@/lib/unitConversion` + `@/lib/numberFormat` run
 * untouched — the conversion math the hook leans on is genuinely executed, so a
 * regression in any formula (or a lost null guard) fails loudly here.
 *
 * Facets covered:
 *   1. LOADING     — flags + every collection empty, no throw, default center.
 *   2. ERROR       — the query error is forwarded verbatim; drive/stats null.
 *   3. VEHICLE     — useVehicle is asked for String(vehicleId), '' when no drive.
 *   4. ROUTE       — trail comes from telemetry, filtering null + (0,0) points;
 *                    start/end anchors; positions are the fallback source.
 *   5. CENTER      — anchor fallback chain: trail[0] → drive start coord → Seattle.
 *   6. SEGMENTS    — speed→colour bands keyed on the SI m/s thresholds.
 *   7. CHART km    — metric conversion of speed/temp/range/pressure + null passthrough.
 *   8. CHART mi    — the imperial branch converts to mph/°F/mi/psi.
 *   9. POSITIONS   — snake_case fallback fields + camelCase-only null columns.
 *  10. STATS       — every aggregate derived from an SI drive + telemetry.
 *  11. STATS f/b   — computed energy/regen/power/minSpd when aggregates are null.
 *  12. CLIMATE     — On / Mostly Off / Off / null status branches.
 *  13. HISTOGRAM   — display-unit buckets, empty buckets dropped, pct rounded.
 *  14. MEMO        — stable refs across a no-op re-render (pins the useCallback +
 *                    map-anchor useMemo hardening; stats would churn otherwise).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { UnitPref } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail, DriveTelemetryPoint, DrivePosition } from '@/types/driving';
import type { Vehicle } from '@/types/vehicle';

// ── Mutable holder shared with the hoisted vi.mock factories. Tests mutate
//    H.drive / H.unitPrefs / H.error etc. before rendering; each mock reads the
//    latest value at call time. `formatTime` is a STABLE reference (not reset)
//    so the chartData memo doesn't churn between re-renders. ──
const H = vi.hoisted(() => ({
  drive: undefined as DriveDetail | undefined,
  isLoading: false,
  error: null as unknown,
  vehicle: undefined as unknown,
  vehicleIdArg: '' as string,
  unitPrefs: null as unknown as UnitPref,
  formatTime: (v: unknown): string => (v == null ? '—' : String(v)),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrive: vi.fn(() => ({ data: H.drive, isLoading: H.isLoading, error: H.error })),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: vi.fn((id: string) => {
    H.vehicleIdArg = id;
    return { data: H.vehicle };
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: H.unitPrefs }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: H.formatTime }),
}));

import { useDriveDetailData } from './useDriveDetailData';
import {
  SPEED_SEGMENT_LOW_MPS,
  SPEED_SEGMENT_MED_MPS,
  SPEED_SEGMENT_HIGH_MPS,
} from './constants';

// ── Unit-preference fixtures (stable references so the memo test can rely on
//    referential identity). ──
const METRIC: UnitPref = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: 2,
};
const IMPERIAL: UnitPref = {
  distance: 'mi',
  speed: 'mph',
  temperature: '°F',
  pressure: 'psi',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: 2,
};

// SI conversion factors (mirror @/lib/unitConversion) for expected values.
const MPS_TO_KMH = 3.6;
const MPS_TO_MPH = 3600 / 1609.344;
const M_TO_MI = 1 / 1609.344;
const KPA_PER_PSI = 6.894757;

// ── Fixture factories: fully-populated shapes so overrides read cleanly. ──
function tele(o: Partial<DriveTelemetryPoint> = {}): DriveTelemetryPoint {
  return {
    timestamp: '1970-01-01T00:00:00Z',
    speed: null,
    power: null,
    batteryLevel: null,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    elevation: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: null,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: null,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...o,
  };
}

// Positions are read through an `any` cast in the hook (snake_case fallback),
// so the factory accepts arbitrary extra keys and casts the result.
function pos(o: Record<string, unknown> = {}): DrivePosition {
  return {
    latitude: 0,
    longitude: 0,
    speed: null,
    power: null,
    batteryLevel: 0,
    timestamp: '1970-01-01T00:00:00Z',
    insideTemp: null,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: null,
    elevation: null,
    fanStatus: null,
    isClimateOn: null,
    ...o,
  } as DrivePosition;
}

function drive(o: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2024-01-01T08:00:00Z',
    endTs: '2024-01-01T09:00:00Z',
    durationS: 3600,
    distanceM: 100000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '2024-01-01T08:00:00Z',
    updatedAt: '2024-01-01T09:00:00Z',
    positions: [],
    telemetry: [],
    ...o,
  };
}

function setup(d?: DriveDetail, prefs: UnitPref = METRIC) {
  H.drive = d;
  H.unitPrefs = prefs;
  return renderHook(() => useDriveDetailData('42'));
}

beforeEach(() => {
  H.drive = undefined;
  H.isLoading = false;
  H.error = null;
  H.vehicle = undefined;
  H.vehicleIdArg = '';
  H.unitPrefs = METRIC;
});

// ---------------------------------------------------------------------------
describe('useDriveDetailData — loading & error', () => {
  it('returns empty collections, null stats, and the Seattle default center while loading', () => {
    H.isLoading = true;
    const { result } = setup(undefined);
    const r = result.current;

    expect(r.isLoading).toBe(true);
    expect(r.drive).toBeNull();
    expect(r.vehicle).toBeNull();
    expect(r.stats).toBeNull();
    expect(r.chartData).toEqual([]);
    expect(r.trail).toEqual([]);
    expect(r.speedSegments).toEqual([]);
    expect(r.speedHistData).toEqual([]);
    expect(r.startPos).toBeUndefined();
    expect(r.endPos).toBeUndefined();
    expect(r.centerPos).toEqual([47.6, -122.3]);
  });

  it('forwards the query error verbatim and keeps drive/stats null', () => {
    const boom = new Error('drive fetch failed');
    H.error = boom;
    const { result } = setup(undefined);

    expect(result.current.error).toBe(boom);
    expect(result.current.drive).toBeNull();
    expect(result.current.stats).toBeNull();
  });
});

describe('useDriveDetailData — vehicle lookup wiring', () => {
  it('asks useVehicle for the stringified drive.vehicleId and forwards the vehicle', () => {
    const veh = { id: 7, displayName: 'Model 3' } as unknown as Vehicle;
    H.vehicle = veh;
    const { result } = setup(drive({ vehicleId: 7 }));

    expect(H.vehicleIdArg).toBe('7');
    expect(result.current.vehicle).toBe(veh);
  });

  it('asks useVehicle for an empty string when there is no drive yet', () => {
    setup(undefined);
    expect(H.vehicleIdArg).toBe('');
  });
});

describe('useDriveDetailData — route trail', () => {
  it('builds the trail from telemetry, dropping null and (0,0) coordinates', () => {
    const { result } = setup(
      drive({
        telemetry: [
          tele({ latitude: 47.6, longitude: -122.3, speed: 10 }),
          tele({ latitude: null, longitude: -122.31, speed: 12 }), // dropped: null lat
          tele({ latitude: 0, longitude: 0, speed: 0 }), // dropped: null island
          tele({ latitude: 47.62, longitude: -122.32, speed: 14 }),
        ],
        // positions must be ignored when telemetry is present
        positions: [pos({ latitude: 1, longitude: 1 })],
      }),
    );

    expect(result.current.trail).toEqual([
      [47.6, -122.3],
      [47.62, -122.32],
    ]);
    expect(result.current.startPos).toEqual([47.6, -122.3]);
    expect(result.current.endPos).toEqual([47.62, -122.32]);
  });

  it('falls back to positions when telemetry is empty, dropping (0,0) rows', () => {
    const { result } = setup(
      drive({
        telemetry: [],
        positions: [
          pos({ latitude: 47.6, longitude: -122.3 }),
          pos({ latitude: 0, longitude: 0 }), // dropped
          pos({ latitude: 47.62, longitude: -122.32 }),
        ],
      }),
    );

    expect(result.current.trail).toEqual([
      [47.6, -122.3],
      [47.62, -122.32],
    ]);
  });

  it('leaves endPos undefined for a single-point trail', () => {
    const { result } = setup(
      drive({ telemetry: [tele({ latitude: 47.6, longitude: -122.3 })] }),
    );

    expect(result.current.startPos).toEqual([47.6, -122.3]);
    expect(result.current.endPos).toBeUndefined();
  });
});

describe('useDriveDetailData — center fallback chain', () => {
  it('uses the first trail point when a route exists', () => {
    const { result } = setup(
      drive({
        startLat: 10,
        startLon: 20,
        telemetry: [
          tele({ latitude: 47.6, longitude: -122.3 }),
          tele({ latitude: 47.7, longitude: -122.4 }),
        ],
      }),
    );
    expect(result.current.centerPos).toEqual([47.6, -122.3]);
  });

  it('uses the drive start coordinate when there is no trail', () => {
    const { result } = setup(drive({ startLat: 34.05, startLon: -118.24 }));
    expect(result.current.centerPos).toEqual([34.05, -118.24]);
  });

  it('falls back to the Seattle default when neither trail nor start coord exists', () => {
    const { result } = setup(drive({ startLat: null, startLon: null }));
    expect(result.current.centerPos).toEqual([47.6, -122.3]);
  });
});

describe('useDriveDetailData — speed-coloured segments', () => {
  it('maps each SI m/s speed band to its colour and yields N-1 segments', () => {
    // routeSource speeds are raw m/s; colour keyed on curr (the i-th) point.
    const { result } = setup(
      drive({
        telemetry: [
          tele({ latitude: 1, longitude: 1, speed: SPEED_SEGMENT_LOW_MPS - 1 }), // slow
          tele({ latitude: 2, longitude: 2, speed: SPEED_SEGMENT_LOW_MPS - 1 }), // curr: green
          tele({ latitude: 3, longitude: 3, speed: SPEED_SEGMENT_LOW_MPS + 1 }), // curr: cyan
          tele({ latitude: 4, longitude: 4, speed: SPEED_SEGMENT_MED_MPS + 1 }), // curr: amber
          tele({ latitude: 5, longitude: 5, speed: SPEED_SEGMENT_HIGH_MPS + 1 }), // curr: red
        ],
      }),
    );

    const segs = result.current.speedSegments;
    expect(segs).toHaveLength(4);
    expect(segs.map((s) => s.color)).toEqual([
      '#10b981', // green — below low
      '#00f0ff', // cyan — >= low
      '#f59e0b', // amber — >= med
      '#ef4444', // red — >= high
    ]);
    // Each segment spans the previous → current coordinate pair.
    expect(segs[0].positions).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});

describe('useDriveDetailData — chart data conversion', () => {
  it('converts telemetry to the metric display units and keeps nullable fields null', () => {
    const { result } = setup(
      drive({
        telemetry: [
          tele({
            latitude: 47.6,
            longitude: -122.3,
            createdAt: '08:00',
            speed: 10, // m/s
            batteryLevel: 82,
            elevation: 100,
            power: 15,
            outsideTemp: 20,
            insideTemp: 22,
            idealRange: 300000, // m
            odometer: 1_000_000, // m
            tirePressureFl: 250000, // Pa
            soc: 80,
            isClimateOn: true,
            fanStatus: 3,
            // driverTemp / passengerTemp / ratedRange left null
          }),
        ],
      }),
      METRIC,
    );

    const c = result.current.chartData[0];
    expect(c.time).toBe('08:00'); // formatTime echoes createdAt
    expect(c.speed).toBeCloseTo(10 * MPS_TO_KMH, 5); // 36 km/h
    expect(c.battery).toBe(82);
    expect(c.elevation).toBe(100);
    expect(c.outsideTemp).toBeCloseTo(20, 5); // °C passthrough
    expect(c.idealRange).toBeCloseTo(300, 5); // 300000 m → 300 km
    expect(c.odometer).toBeCloseTo(1000, 5);
    expect(c.tireFl).toBeCloseTo(2.5, 5); // 250000 Pa → 250 kPa → 2.5 bar
    expect(c.driverTemp).toBeNull();
    expect(c.ratedRange).toBeNull();
    expect(c.climateOn).toBe(true);
  });

  it('null-coalesces missing battery/elevation/power/speed to 0', () => {
    const { result } = setup(
      drive({ telemetry: [tele({ latitude: 47.6, longitude: -122.3, createdAt: '08:00' })] }),
    );
    const c = result.current.chartData[0];
    expect(c.speed).toBe(0);
    expect(c.battery).toBe(0);
    expect(c.elevation).toBe(0);
    expect(c.power).toBe(0);
  });

  it('converts to imperial units when the pressure/speed/temp/distance prefs flip', () => {
    const { result } = setup(
      drive({
        telemetry: [
          tele({
            latitude: 47.6,
            longitude: -122.3,
            createdAt: '08:00',
            speed: 20, // m/s
            outsideTemp: 20, // °C
            idealRange: 100000, // m
            tirePressureFl: 250000, // Pa
          }),
        ],
      }),
      IMPERIAL,
    );

    const c = result.current.chartData[0];
    expect(c.speed).toBeCloseTo(20 * MPS_TO_MPH, 4); // ~44.74 mph
    expect(c.outsideTemp).toBeCloseTo(68, 5); // 20°C → 68°F
    expect(c.idealRange).toBeCloseTo(100000 * M_TO_MI, 4); // ~62.14 mi
    expect(c.tireFl).toBeCloseTo(250 / KPA_PER_PSI, 4); // ~36.26 psi
  });

  it('reads snake_case fallback fields from positions and nulls telemetry-only columns', () => {
    const { result } = setup(
      drive({
        telemetry: [],
        positions: [
          pos({
            latitude: 47.6,
            longitude: -122.3,
            created_at: '09:15', // snake_case time fallback
            speed: 10,
            batteryLevel: undefined, // snake_case-only row: camelCase absent
            battery_level: 55, // snake_case battery fallback
            outside_temp: 10, // snake_case temp fallback
            ideal_range: 200000, // snake_case range fallback
          }),
        ],
      }),
    );

    const c = result.current.chartData[0];
    expect(c.time).toBe('09:15');
    expect(c.battery).toBe(55);
    expect(c.outsideTemp).toBeCloseTo(10, 5);
    expect(c.idealRange).toBeCloseTo(200, 5); // 200000 m → 200 km
    // positions never carry these — the branch hard-codes null:
    expect(c.driverTemp).toBeNull();
    expect(c.estRange).toBeNull();
    expect(c.soc).toBeNull();
  });
});

describe('useDriveDetailData — stats', () => {
  const statsDrive = drive({
    distanceM: 100000,
    durationS: 3600,
    maxSpeedMps: 30,
    avgSpeedMps: 20,
    avgPowerW: 20000,
    energyUsedWh: 15000,
    regenEnergyWh: 2000,
    startBatteryPct: 80,
    endBatteryPct: 60,
    telemetry: [
      tele({
        latitude: 47.6, longitude: -122.3, createdAt: '08:00',
        speed: 10, power: 15, elevation: 100,
        outsideTemp: 20, insideTemp: 22, driverTemp: 21, passengerTemp: 23,
        idealRange: 300000, odometer: 1_000_000, tirePressureFl: 250000,
        isClimateOn: true, fanStatus: 3,
      }),
      tele({
        latitude: 47.61, longitude: -122.31, createdAt: '08:01',
        speed: 20, power: -5, elevation: 150,
        outsideTemp: 22, insideTemp: 23, driverTemp: 22, passengerTemp: 24,
        idealRange: 280000, odometer: 1_005_000, tirePressureFl: 252000,
        isClimateOn: true, fanStatus: 5,
      }),
      tele({
        latitude: 47.62, longitude: -122.32, createdAt: '08:02',
        speed: 0, power: 0, elevation: 120,
        outsideTemp: 21, insideTemp: 22.5, driverTemp: 21.5, passengerTemp: 23.5,
        idealRange: 270000, odometer: 1_010_000, tirePressureFl: 251000,
        isClimateOn: false, fanStatus: 0,
      }),
    ],
  });

  it('derives every aggregate display stat from an SI drive + telemetry', () => {
    const { result } = setup(statsDrive, METRIC);
    const s = result.current.stats!;

    expect(s).not.toBeNull();
    expect(s.maxSpd).toBeCloseTo(108, 5); // 30 m/s → km/h
    expect(s.avgSpd).toBeCloseTo(72, 5); // 20 m/s → km/h
    expect(s.minSpd).toBeCloseTo(36, 5); // min non-zero display speed (10 m/s)
    expect(s.powerMax).toBe(15);
    expect(s.powerMin).toBe(-5);
    expect(s.avgPower).toBe(20); // avgPowerW 20000 → kW
    expect(s.energyWh).toBe(15000);
    expect(s.regenWh).toBe(2000);
    expect(s.consumptionWhKm).toBeCloseTo(150, 5); // 15000 Wh / 100 km
    expect(s.elevGain).toBe(50); // +50 then -30
    expect(s.elevLoss).toBe(30);
    expect(s.avgOutsideTemp).toBeCloseTo(21, 5);
    expect(s.avgInsideTemp).toBeCloseTo(22.5, 5);
    expect(s.hasAnyTemp).toBe(true);
    expect(s.climateStatus).toBe('On');
    expect(s.avgFanSpeed).toBeCloseTo(8 / 3, 5);
    expect(s.maxFanSpeed).toBe(5);
    expect(s.startRange).toBeCloseTo(300, 5); // 300000 m → 300 km
    expect(s.endRange).toBeCloseTo(270, 5);
    expect(s.odometerStart).toBeCloseTo(1000, 5);
    expect(s.odometerEnd).toBeCloseTo(1010, 5);
    expect(s.hasTirePressure).toBe(true);
    expect(s.efficiencyPctPer100).toBeCloseTo(2, 5); // (80-60)/100km*10
  });

  it('computes energy/regen/power fallbacks when the drive aggregates are absent', () => {
    const { result } = setup(
      drive({
        distanceM: 50000,
        durationS: 3600,
        // maxSpeedMps / avgSpeedMps / avgPowerW / energyUsedWh / regenEnergyWh all null
        telemetry: [
          tele({ latitude: 1, longitude: 1, createdAt: 't0', speed: 5, power: -10 }),
          tele({ latitude: 2, longitude: 2, createdAt: 't1', speed: 10, power: -20 }),
        ],
      }),
      METRIC,
    );
    const s = result.current.stats!;

    expect(s.maxSpd).toBe(0); // no maxSpeedMps
    expect(s.avgSpd).toBe(0); // no avgSpeedMps
    expect(s.powerMax).toBe(-10); // max of [-10,-20]
    expect(s.powerMin).toBe(-20);
    expect(s.avgPower).toBe(-15); // mean of chart powers
    expect(s.energyWh).toBeCloseTo(15000, 5); // |avgPower| * 1h * 1000
    expect(s.regenWh).toBeCloseTo(15000, 5); // (10+20) * (1/2) * 1000
    expect(s.minSpd).toBeCloseTo(5 * MPS_TO_KMH, 5); // 18 km/h
  });

  it('reports minSpd = 0 when the car never moves and powerMax falls back to avgPowerW', () => {
    const { result } = setup(
      drive({
        avgPowerW: 8000,
        telemetry: [
          tele({ latitude: 1, longitude: 1, createdAt: 't0', speed: 0, power: 0 }),
          tele({ latitude: 2, longitude: 2, createdAt: 't1', speed: 0, power: 0 }),
        ],
      }),
    );
    const s = result.current.stats!;

    expect(s.minSpd).toBe(0);
    expect(s.powerMax).toBe(8); // no per-row power → avgPowerW 8000 / 1000
    expect(s.powerMin).toBe(0);
  });

  it('returns null stats when there is no drive', () => {
    const { result } = setup(undefined);
    expect(result.current.stats).toBeNull();
  });
});

describe('useDriveDetailData — climate status branches', () => {
  function climate(...flags: (boolean | null)[]): DriveDetail {
    return drive({
      telemetry: flags.map((f, i) =>
        tele({ latitude: i + 1, longitude: i + 1, createdAt: `t${i}`, isClimateOn: f }),
      ),
    });
  }

  it('is "On" when the on-samples are the majority', () => {
    expect(setup(climate(true, true, false)).result.current.stats!.climateStatus).toBe('On');
  });

  it('is "Mostly Off" when climate ran but off-samples dominate', () => {
    expect(
      setup(climate(true, false, false, false)).result.current.stats!.climateStatus,
    ).toBe('Mostly Off');
  });

  it('is "Off" when climate was never on', () => {
    expect(setup(climate(false, false)).result.current.stats!.climateStatus).toBe('Off');
  });

  it('is null when no climate samples were recorded', () => {
    expect(setup(climate(null, null)).result.current.stats!.climateStatus).toBeNull();
  });
});

describe('useDriveDetailData — speed histogram', () => {
  it('buckets display-unit speeds, drops empty buckets, and rounds the percentage', () => {
    // Metric speeds must land in the 0–20, 20–40 and 120+ buckets: pick SI m/s
    // that convert to 10, 30 and 130 km/h respectively.
    const { result } = setup(
      drive({
        telemetry: [
          tele({ latitude: 1, longitude: 1, createdAt: 't0', speed: 10 / MPS_TO_KMH }),
          tele({ latitude: 2, longitude: 2, createdAt: 't1', speed: 30 / MPS_TO_KMH }),
          tele({ latitude: 3, longitude: 3, createdAt: 't2', speed: 130 / MPS_TO_KMH }),
        ],
      }),
      METRIC,
    );

    const hist = result.current.speedHistData;
    expect(hist).toHaveLength(3); // only the 3 non-empty buckets survive
    expect(hist.every((b) => b.pct === 33)).toBe(true); // round(1/3*100)
    expect(hist[0].range).toBe(`${fmtNumber(0)}–${fmtNumber(20)}`);
    expect(hist[2].range).toBe(`${fmtNumber(120)}+`); // top open-ended bucket
  });

  it('returns an empty histogram when there is no chart data', () => {
    const { result } = setup(drive({ telemetry: [], positions: [] }));
    expect(result.current.speedHistData).toEqual([]);
  });
});

describe('useDriveDetailData — memoisation contract', () => {
  it('keeps derived outputs referentially stable across a no-op re-render', () => {
    // A drive with NO trail but a start coordinate: centerPos must come from the
    // memoised anchor block (a fresh [lat,lon] literal each render would break
    // identity), and stats must survive the useCallback-stabilised converters.
    const shared = drive({
      startLat: 47.6,
      startLon: -122.3,
      distanceM: 42000,
      telemetry: [],
      positions: [],
    });

    const { result, rerender } = setup(shared, METRIC);
    const before = result.current;

    rerender();
    const after = result.current;

    expect(after.stats).toBe(before.stats);
    expect(after.chartData).toBe(before.chartData);
    expect(after.trail).toBe(before.trail);
    expect(after.speedSegments).toBe(before.speedSegments);
    expect(after.centerPos).toBe(before.centerPos);
  });
});
