/**
 * drive-detail `types.ts` — data-contract regression harness.
 *
 * `types.ts` is a pure type-declaration module: its five exports
 * (`ChartDataPoint`, `DriveStats`, `RoutePoint`, `SpeedSegment`,
 * `SpeedHistogramBucket`) carry no runtime code, so a smoke import proves
 * nothing. What actually matters is that the ONE producer of these shapes —
 * `useDriveDetailData` — keeps emitting objects that satisfy every field of
 * every interface, with the exact SI-vs-display unit semantics the interfaces
 * document. If the producer ever drops a key, mis-coalesces a `null`, or stops
 * converting a display field, the charts silently break with no type error to
 * catch it (test files are excluded from `tsc`). So this suite pins the contract
 * at RUNTIME through the real producer — the same strategy `constants.test.ts`
 * uses for the speed constants — rather than asserting the interfaces back to
 * themselves.
 *
 * The four boundary hooks (`useDrive`, `useVehicle`, `useUnits`, `useDateFormat`)
 * are mocked to feed deterministic drives + unit preferences; the pure SI
 * converters in `@/lib/unitConversion` and `fmtNumber` run for real so the
 * asserted display values exercise the genuine conversion path. `RoutePoint` is
 * an internal intermediate, so it is verified through the `trail` /
 * `speedSegments` it produces.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  convertSpeedFromSI,
  convertDistanceFromSI,
  convertTempFromSI,
  convertPressureFromSI,
} from '@/lib/unitConversion';
import type { DriveDetail, DrivePosition, DriveTelemetryPoint } from '@/types/driving';
import type {
  ChartDataPoint,
  DriveStats,
  RoutePoint,
  SpeedSegment,
  SpeedHistogramBucket,
} from './types';
import { useDriveDetailData } from './useDriveDetailData';

/* ── Hoisted, mutable mock state (read inside the vi.mock factories) ────────── */
const mocks = vi.hoisted(() => {
  const metric = {
    distance: 'km',
    speed: 'km/h',
    temperature: '°C',
    pressure: 'bar',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
    precision: 1,
  };
  return {
    metric,
    drive: null as unknown,
    prefs: { ...metric } as Record<string, unknown>,
    isLoading: false,
    error: null as unknown,
  };
});

vi.mock('@/api/hooks/useDriving', () => ({
  useDrive: () => ({ data: mocks.drive, isLoading: mocks.isLoading, error: mocks.error }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: () => ({ data: null }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: mocks.prefs }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v ?? '') }),
}));

/* ── Fixtures ──────────────────────────────────────────────────────────────── */
function makeTele(overrides: Partial<DriveTelemetryPoint> = {}): DriveTelemetryPoint {
  return {
    timestamp: '2025-03-01T10:00:00Z',
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
    ...overrides,
  };
}

function makeDrive(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2025-03-01T10:00:00Z',
    endTs: '2025-03-01T10:45:00Z',
    durationS: 1800,
    distanceM: 36000,
    startAddress: 'A',
    endAddress: 'B',
    startLat: 47.6,
    startLon: -122.3,
    endLat: 47.62,
    endLon: -122.3,
    startBatteryPct: 80,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 4000,
    outsideTempAvgC: 14,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2025-03-01T10:45:05Z',
    updatedAt: '2025-03-01T10:45:05Z',
    positions: [],
    telemetry: [],
    ...overrides,
  };
}

function render(drive: unknown) {
  mocks.drive = drive;
  return renderHook(() => useDriveDetailData('42')).result;
}

const CHART_KEYS: Array<keyof ChartDataPoint> = [
  'time', 'speed', 'battery', 'elevation', 'power',
  'outsideTemp', 'insideTemp', 'driverTemp', 'passengerTemp',
  'idealRange', 'ratedRange', 'estRange', 'odometer',
  'soc', 'usableSoc', 'tireFl', 'tireFr', 'tireRl', 'tireRr',
  'climateOn', 'fanStatus',
];

const STATS_KEYS: Array<keyof DriveStats> = [
  'maxSpd', 'avgSpd', 'minSpd', 'powerMax', 'powerMin', 'avgPower',
  'energyWh', 'regenWh', 'consumptionWhKm', 'elevGain', 'elevLoss',
  'avgOutsideTemp', 'avgInsideTemp', 'hasAnyTemp',
  'insideTemps', 'outsideTemps', 'driverTemps', 'passengerTemps',
  'climateStatus', 'avgFanSpeed', 'maxFanSpeed',
  'startRange', 'endRange', 'odometerStart', 'odometerEnd',
  'hasTirePressure', 'efficiencyPctPer100',
];

beforeEach(() => {
  mocks.drive = null;
  mocks.prefs = { ...mocks.metric };
  mocks.isLoading = false;
  mocks.error = null;
});

/* ── ChartDataPoint ─────────────────────────────────────────────────────────── */
describe('ChartDataPoint contract (via useDriveDetailData.chartData)', () => {
  it('emits exactly the declared keys with the right runtime types for a full sample', () => {
    const point = makeTele({
      speed: 10, batteryLevel: 82, elevation: 125, power: 7.5,
      outsideTemp: 14, insideTemp: 21, driverTemp: 20, passengerTemp: 19,
      idealRange: 400000, ratedRange: 380000, estRange: 360000, odometer: 1_000_000,
      soc: 81.5, usableSoc: 80,
      tirePressureFl: 250000, tirePressureFr: 260000,
      tirePressureRl: 255000, tirePressureRr: 265000,
      isClimateOn: true, fanStatus: 5,
    });
    const chart: ChartDataPoint[] = render(makeDrive({ telemetry: [point] })).current.chartData;

    expect(chart).toHaveLength(1);
    const p = chart[0];
    // Shape: the producer must satisfy the interface key-for-key.
    expect(Object.keys(p).sort()).toEqual([...CHART_KEYS].sort());
    // Required numerics are real numbers (never undefined/NaN).
    for (const k of ['speed', 'battery', 'elevation', 'power'] as const) {
      expect(typeof p[k]).toBe('number');
      expect(Number.isFinite(p[k])).toBe(true);
    }
    expect(typeof p.time).toBe('string');
    expect(typeof p.climateOn).toBe('boolean');
    expect(typeof p.fanStatus).toBe('number');
  });

  it('converts every SI field to the active display unit (metric)', () => {
    const point = makeTele({
      speed: 10, elevation: 125, outsideTemp: 14, insideTemp: 21,
      idealRange: 400000, odometer: 1_000_000, tirePressureFl: 250000, batteryLevel: 82,
    });
    const p = render(makeDrive({ telemetry: [point] })).current.chartData[0];

    expect(p.speed).toBeCloseTo(convertSpeedFromSI(10, 'km/h'), 6); // 36 km/h
    expect(p.speed).toBeCloseTo(36, 6);
    expect(p.idealRange).toBeCloseTo(convertDistanceFromSI(400000, 'km'), 6); // 400 km
    expect(p.outsideTemp).toBeCloseTo(convertTempFromSI(14, '°C'), 6); // identity
    expect(p.tireFl).toBeCloseTo(convertPressureFromSI(250, 'bar'), 6); // 2.5 bar
    // battery + elevation are NOT unit-converted — they pass through raw.
    expect(p.battery).toBe(82);
    expect(p.elevation).toBe(125);
  });

  it('re-derives the display fields when the unit preference flips to imperial', () => {
    const point = makeTele({ speed: 10, odometer: 1_609_344, outsideTemp: 100, tirePressureFl: 100000 });
    const metricPt = render(makeDrive({ telemetry: [point] })).current.chartData[0];
    expect(metricPt.speed).toBeCloseTo(36, 6);

    mocks.prefs = { ...mocks.metric, distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi' };
    const imperialPt = render(makeDrive({ telemetry: [point] })).current.chartData[0];

    expect(imperialPt.speed).toBeCloseTo(convertSpeedFromSI(10, 'mph'), 6); // ~22.37 mph
    expect(imperialPt.speed).not.toBeCloseTo(36, 3); // branch genuinely changed
    expect(imperialPt.odometer).toBeCloseTo(1000, 6); // 1 609 344 m → 1000 mi
    expect(imperialPt.outsideTemp).toBeCloseTo(212, 6); // 100 °C → 212 °F
    expect(imperialPt.tireFl).toBeCloseTo(convertPressureFromSI(100, 'psi'), 6);
  });

  it('coalesces absent required fields to 0 and absent optionals to null', () => {
    const p = render(makeDrive({ telemetry: [makeTele()] })).current.chartData[0];

    expect(p.speed).toBe(0);
    expect(p.battery).toBe(0);
    expect(p.elevation).toBe(0);
    expect(p.power).toBe(0);
    const nullable: Array<keyof ChartDataPoint> = [
      'outsideTemp', 'insideTemp', 'driverTemp', 'passengerTemp',
      'idealRange', 'ratedRange', 'estRange', 'odometer', 'soc', 'usableSoc',
      'tireFl', 'tireFr', 'tireRl', 'tireRr', 'climateOn', 'fanStatus',
    ];
    for (const k of nullable) expect(p[k]).toBeNull();
  });

  it('falls back to positions when telemetry is empty (position-branch nulls)', () => {
    const pos: DrivePosition = {
      latitude: 47.6, longitude: -122.3, speed: 20, power: 4,
      batteryLevel: 70, timestamp: '2025-03-01T10:00:00Z',
      insideTemp: 22, outsideTemp: 12, idealRange: 300000, ratedRange: 290000,
      odometer: 900000, elevation: 90, fanStatus: 2, isClimateOn: true,
    };
    const chart = render(makeDrive({ telemetry: [], positions: [pos] })).current.chartData;

    expect(chart).toHaveLength(1);
    const p = chart[0];
    expect(Object.keys(p).sort()).toEqual([...CHART_KEYS].sort());
    expect(p.speed).toBeCloseTo(convertSpeedFromSI(20, 'km/h'), 6); // 72 km/h
    expect(p.battery).toBe(70);
    expect(p.outsideTemp).toBeCloseTo(12, 6);
    expect(p.climateOn).toBe(true);
    // Fields the position branch cannot supply are hard-nulled.
    for (const k of ['driverTemp', 'passengerTemp', 'estRange', 'soc', 'usableSoc', 'tireFl'] as const) {
      expect(p[k]).toBeNull();
    }
  });
});

/* ── DriveStats ─────────────────────────────────────────────────────────────── */
describe('DriveStats contract (via useDriveDetailData.stats)', () => {
  function fourPointDrive(): DriveDetail {
    return makeDrive({
      telemetry: [
        makeTele({ speed: 0, power: 5, elevation: 100, outsideTemp: 10, insideTemp: 22, idealRange: 500000, soc: 80, tirePressureFl: 250000, isClimateOn: true, fanStatus: 3 }),
        makeTele({ speed: 10, power: -3, elevation: 150, insideTemp: 24, odometer: 1_000_000, soc: 78, isClimateOn: true }),
        makeTele({ speed: 20, power: 8, elevation: 120, outsideTemp: 20, soc: 75, isClimateOn: false, fanStatus: 5 }),
        makeTele({ speed: 5, power: -10, elevation: 130, idealRange: 480000, odometer: 1_005_000, soc: 70, isClimateOn: false }),
      ],
    });
  }

  it('derives a fully-populated DriveStats with the declared keys and types', () => {
    const stats = render(fourPointDrive()).current.stats;
    if (!stats) throw new Error('expected non-null stats');
    const s: DriveStats = stats;

    expect(Object.keys(s).sort()).toEqual([...STATS_KEYS].sort());
    for (const k of ['insideTemps', 'outsideTemps', 'driverTemps', 'passengerTemps'] as const) {
      expect(Array.isArray(s[k])).toBe(true);
    }
    expect(typeof s.hasAnyTemp).toBe('boolean');
    expect(typeof s.hasTirePressure).toBe('boolean');
    expect(Number.isFinite(s.energyWh)).toBe(true);
  });

  it('computes speed, power, energy and consumption aggregates', () => {
    const s = render(fourPointDrive()).current.stats!;
    expect(s.maxSpd).toBeCloseTo(convertSpeedFromSI(30, 'km/h'), 6); // 108
    expect(s.avgSpd).toBeCloseTo(convertSpeedFromSI(15, 'km/h'), 6); // 54
    expect(s.minSpd).toBeCloseTo(18, 6); // min non-zero display speed (5 m/s → 18 km/h)
    expect(s.powerMax).toBe(8);
    expect(s.powerMin).toBe(-10);
    expect(s.avgPower).toBeCloseTo(4, 6); // 4000 W → 4 kW
    expect(s.energyWh).toBe(7200);
    expect(s.regenWh).toBe(900);
    expect(s.consumptionWhKm).toBeCloseTo(200, 6); // 7200 Wh / 36 km
    expect(s.efficiencyPctPer100).toBeCloseTo(12 / 36 * 10, 6);
  });

  it('accumulates elevation gain/loss and temperature / climate / fan aggregates', () => {
    const s = render(fourPointDrive()).current.stats!;
    expect(s.elevGain).toBeCloseTo(60, 6); // +50 then +10
    expect(s.elevLoss).toBeCloseTo(30, 6); // -30
    expect(s.outsideTemps).toEqual([10, 20]);
    expect(s.avgOutsideTemp).toBeCloseTo(15, 6);
    expect(s.avgInsideTemp).toBeCloseTo(23, 6); // (22 + 24) / 2
    expect(s.hasAnyTemp).toBe(true);
    expect(s.climateStatus).toBe('On'); // 2 on vs 2 off → On (on >= off)
    expect(s.avgFanSpeed).toBeCloseTo(4, 6); // (3 + 5) / 2
    expect(s.maxFanSpeed).toBe(5);
  });

  it('scans sparse range + odometer samples for real start/end values', () => {
    const s = render(fourPointDrive()).current.stats!;
    expect(s.startRange).toBeCloseTo(500, 6); // first idealRange 500 000 m → 500 km
    expect(s.endRange).toBeCloseTo(480, 6); // last idealRange 480 000 m → 480 km
    expect(s.odometerStart).toBeCloseTo(1000, 6); // first non-null odometer
    expect(s.odometerEnd).toBeCloseTo(1005, 6); // last non-null odometer
    expect(s.hasTirePressure).toBe(true);
  });

  it('returns a safe all-defaults DriveStats for a drive with no samples', () => {
    const s = render(makeDrive({ telemetry: [], positions: [] })).current.stats;
    if (!s) throw new Error('expected non-null stats for a present drive');
    expect(s.minSpd).toBe(0);
    expect(s.elevGain).toBe(0);
    expect(s.odometerStart).toBe(0);
    expect(s.hasAnyTemp).toBe(false);
    expect(s.climateStatus).toBeNull();
    expect(s.avgFanSpeed).toBeNull();
    expect(s.outsideTemps).toEqual([]);
    expect(Number.isNaN(s.consumptionWhKm)).toBe(false);
  });

  it('is null (not a blank object) when no drive is loaded', () => {
    const { current } = render(null);
    expect(current.stats).toBeNull();
    expect(current.chartData).toEqual([]);
    expect(current.speedHistData).toEqual([]);
    expect(current.trail).toEqual([]);
    expect(current.speedSegments).toEqual([]);
    expect(current.startPos).toBeUndefined();
  });
});

/* ── SpeedHistogramBucket ───────────────────────────────────────────────────── */
describe('SpeedHistogramBucket contract (via useDriveDetailData.speedHistData)', () => {
  it('buckets display speeds into {range, pct} rows with integer percentages', () => {
    const drive = makeDrive({
      telemetry: [
        makeTele({ speed: 0 }), // 0 km/h  → 0–20
        makeTele({ speed: 10 }), // 36 km/h → 20–40
        makeTele({ speed: 20 }), // 72 km/h → 60–80
        makeTele({ speed: 5 }), // 18 km/h → 0–20
      ],
    });
    const hist: SpeedHistogramBucket[] = render(drive).current.speedHistData;

    // Only populated bands survive; each carries exactly {range, pct}.
    expect(hist).toHaveLength(3);
    for (const b of hist) {
      expect(Object.keys(b).sort()).toEqual(['pct', 'range']);
      expect(typeof b.range).toBe('string');
      expect(b.range.length).toBeGreaterThan(0);
      expect(Number.isInteger(b.pct)).toBe(true);
      expect(b.pct).toBeGreaterThanOrEqual(0);
      expect(b.pct).toBeLessThanOrEqual(100);
    }
    expect(hist.map((b) => b.pct)).toEqual([50, 25, 25]); // 2/4, 1/4, 1/4
  });

  it('yields no buckets for an empty chart', () => {
    expect(render(makeDrive({ telemetry: [], positions: [] })).current.speedHistData).toEqual([]);
  });
});

/* ── RoutePoint + SpeedSegment ──────────────────────────────────────────────── */
describe('RoutePoint + SpeedSegment contract (via trail / speedSegments)', () => {
  function driveFromRoute(route: RoutePoint[], extraTelemetry: DriveTelemetryPoint[] = []): DriveDetail {
    const telemetry = [
      ...route.map((r) => makeTele({ latitude: r.lat, longitude: r.lng, speed: r.speed })),
      ...extraTelemetry,
    ];
    return makeDrive({ telemetry });
  }

  it('projects RoutePoints into a lat/lng trail and stitched SpeedSegments', () => {
    const route: RoutePoint[] = [
      { lat: 47.6, lng: -122.3, speed: 5 },
      { lat: 47.61, lng: -122.3, speed: 20 },
      { lat: 47.62, lng: -122.3, speed: 45 },
    ];
    const { current } = render(driveFromRoute(route));

    expect(current.trail).toEqual(route.map((r) => [r.lat, r.lng]));
    expect(current.startPos).toEqual([47.6, -122.3]);
    expect(current.endPos).toEqual([47.62, -122.3]);

    const segments: SpeedSegment[] = current.speedSegments;
    expect(segments).toHaveLength(route.length - 1);
    for (const seg of segments) {
      expect(seg.positions).toHaveLength(2);
      expect(seg.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(segments[0].positions).toEqual([
      [47.6, -122.3],
      [47.61, -122.3],
    ]);
  });

  it('drops the (0,0) GPS placeholder before building RoutePoints', () => {
    const route: RoutePoint[] = [
      { lat: 47.6, lng: -122.3, speed: 5 },
      { lat: 47.61, lng: -122.3, speed: 10 },
    ];
    // A (0,0) sample must never reach the trail.
    const withPlaceholder = driveFromRoute(route, [makeTele({ latitude: 0, longitude: 0, speed: 9 })]);
    const { current } = render(withPlaceholder);

    expect(current.trail).toEqual([
      [47.6, -122.3],
      [47.61, -122.3],
    ]);
    expect(current.trail).not.toContainEqual([0, 0]);
  });
});
