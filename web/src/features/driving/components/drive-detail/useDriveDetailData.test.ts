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
import { chartTokens } from '@/lib/tokens';
import type { DriveDetail, DriveTelemetryPoint, DrivePosition } from '@/types/driving';
import type { Vehicle } from '@/types/vehicle';
import { formatTime } from '@/lib/dateFormat';
import type { FormatOptions } from '@/lib/dateFormat';

// ── Mutable holder shared with the hoisted vi.mock factories. Tests mutate
//    H.drive / H.unitPrefs / H.error etc. before rendering; each mock reads the
//    latest value at call time. `formatTime` is a STABLE reference (not reset)
//    so the chartData memo doesn't churn between re-renders. ──
const H = vi.hoisted(() => ({
  drive: undefined as DriveDetail | undefined,
  isLoading: false,
  error: null as unknown,
  vehicle: undefined as Vehicle | undefined,
  vehicleIdArg: '' as string,
  unitPrefs: null as unknown as UnitPref,
  formatTime: (v: unknown): string => (v == null ? '—' : String(v)),
  realDates: false,
  locale: 'de-DE',
  mode: 'vehicle' as 'vehicle' | 'user' | 'utc',
  userTimezone: 'Asia/Tokyo',
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
  useDateFormat: () => ({
    formatTime: H.realDates
      ? (value: string | Date | null | undefined, override?: FormatOptions) =>
        formatTime(value, { locale: H.locale, tz: 'America/Los_Angeles', ...override })
      : H.formatTime,
  }),
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { timezone_user: H.userTimezone, tz_display_default: H.mode, locale: H.locale },
    locale: H.locale,
  }),
}));

import { useDriveDetailData } from './useDriveDetailData';
import { driveEnergyEvidence } from './energyEvidence';
import { interpretDriveDebrief } from './drivePhysicsDebrief';
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
    // Scenarios specify kW; the endpoint fixture carries canonical watts.
    power: o.power == null ? null : o.power * 1000,
  };
}

it('converts canonical signed fractional watts to drive-detail kW without filling gaps', () => {
  const { result } = setup(drive({
    telemetry: [1250.5, -2500.25, 0, null].map(power => ({ ...tele(), power })),
  }));
  expect(result.current.chartData.map(point => point.power)).toEqual([1.2505, -2.50025, 0, null]);
});

it('BUG3 derives fallback average power from observed elapsed intervals rather than row count', () => {
  const { result } = setup(drive({
    endTs: '2024-01-01T08:00:10Z', durationS: 10,
    telemetry: [
      tele({ createdAt: '2024-01-01T08:00:00Z', power: 10 }),
      tele({ createdAt: '2024-01-01T08:00:01Z', power: -10 }),
      tele({ createdAt: '2024-01-01T08:00:02Z', power: -10 }),
      tele({ createdAt: '2024-01-01T08:00:03Z', power: -10 }),
    ],
  }));
  expect(result.current.stats?.avgPower).toBe(-8);
});

// Positions are read through an `any` cast in the hook (snake_case fallback),
// so the factory accepts arbitrary extra keys and casts the result.
function pos(o: Record<string, unknown> = {}): DrivePosition {
  return {
    latitude: 0,
    longitude: 0,
    speed: null,
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
    power: typeof o.power === 'number' ? o.power * 1000 : null,
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
  H.realDates = false;
  H.mode = 'vehicle';
  H.userTimezone = 'Asia/Tokyo';
});

describe('useDriveDetailData — elevation pair evidence', () => {
  it.each([
    [],
    [null, null],
    [undefined, undefined],
    [0],
    [-12.5],
    [0, null, 10],
    [NaN, 0],
    [0, Infinity],
    [-Infinity, 0],
    [-Number.MAX_VALUE, Number.MAX_VALUE],
  ].map((elevations) => ({ elevations })))('keeps insufficient elevation deltas unknown for $elevations', ({ elevations }) => {
    const { result } = setup(drive({
      telemetry: elevations.map((elevation) => tele({ elevation })),
    }));
    expect(result.current.stats?.elevationEvidence).toEqual({
      gainM: null,
      lossM: null,
      eligiblePairCount: 0,
      pairCount: Math.max(elevations.length - 1, 0),
      coverage: elevations.length > 1 ? 0 : null,
    });
  });

  it.each([0, -12.5, 0.25])('keeps actual flat pairs at %s metres as measured zero', (elevation) => {
    const { result } = setup(drive({
      telemetry: [tele({ elevation }), tele({ elevation })],
    }));
    expect(result.current.stats?.elevationEvidence).toEqual({
      gainM: 0, lossM: 0, eligiblePairCount: 1, pairCount: 1, coverage: 1,
    });
  });

  it.each(['telemetry', 'positions'] as const)('preserves signed fractional %s readings and tracks partial pair coverage', (source) => {
    const elevations = [-2.5, -1.75, null, 20, 18.5, 19];
    const { result } = setup(drive(source === 'telemetry'
      ? { telemetry: elevations.map((elevation) => tele({ elevation })) }
      : { positions: elevations.map((elevation) => pos({ elevation })) }));
    expect(result.current.chartData.map((point) => point.elevation)).toEqual(elevations);
    expect(result.current.stats?.elevationEvidence).toEqual({
      gainM: 1.25, lossM: 1.5, eligiblePairCount: 3, pairCount: 5, coverage: 0.6,
    });
    expect(result.current.stats?.elevGain).toBe(1.25);
    expect(result.current.stats?.elevLoss).toBe(1.5);
  });

  it.each([undefined, null, NaN, Infinity, -Infinity, '0', '', false])(
    'normalizes invalid position elevation %s without manufacturing zero',
    (elevation) => {
      const { result } = setup(drive({ positions: [pos({ elevation }), pos({ elevation: 0 })] }));
      expect(result.current.chartData.map((point) => point.elevation)).toEqual([null, 0]);
      expect(result.current.stats?.elevationEvidence.gainM).toBeNull();
      expect(result.current.stats?.elevationEvidence.lossM).toBeNull();
      expect(result.current.stats?.elevationEvidence.eligiblePairCount).toBe(0);
    },
  );

  it('normalizes non-finite telemetry readings to chart gaps', () => {
    const { result } = setup(drive({
      telemetry: [tele({ elevation: NaN }), tele({ elevation: Infinity }), tele({ elevation: -Infinity })],
    }));
    expect(result.current.chartData.map((point) => point.elevation)).toEqual([null, null, null]);
  });
});

describe('useDriveDetailData — record timezone and saved display preferences', () => {
  it.each(['vehicle', 'user', 'utc'] as const)('formats telemetry in %s mode without changing business timezone', (mode) => {
    H.realDates = true;
    H.mode = mode;
    H.vehicle = { timezone: 'America/New_York' } as Vehicle;
    const instant = '2026-01-02T00:30:00Z';
    const { result } = setup(drive({ telemetry: [tele({ timestamp: instant }), tele({ timestamp: 'invalid' })] }));
    const tz = mode === 'vehicle' ? 'America/New_York' : mode === 'user' ? 'Asia/Tokyo' : 'UTC';
    expect(result.current.timezone).toBe('America/New_York');
    expect(result.current.chartData.map(row => row.time)).toEqual([
      formatTime(instant, { locale: 'de-DE', tz }), '—',
    ]);
  });

  it('formats position aliases across midnight and leaves missing dates unknown', () => {
    H.realDates = true;
    H.vehicle = { timezone: 'Pacific/Auckland' } as Vehicle;
    const { result } = setup(drive({ positions: [
      pos({ timestamp: '2026-01-01T23:30:00Z' }),
      pos({ timestamp: undefined }),
    ] }));
    expect(result.current.chartData.map(row => row.time)).toEqual(['12:30', '—']);
  });

  it('uses the saved user zone when the record vehicle zone is unavailable', () => {
    const { result } = setup(drive());
    expect(result.current.timezone).toBe('Asia/Tokyo');
  });
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
      chartTokens.series[1], // green — below low
      chartTokens.series[0], // blue — >= low
      chartTokens.series[2], // amber — >= med
      chartTokens.series[3], // rose — >= high
    ]);
    // Each segment spans the previous → current coordinate pair.
    expect(segs[0].positions).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});

describe('useDriveDetailData — unknown route speed', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'keeps absent/invalid speed %s unknown in telemetry and position routes',
    (speed) => {
      for (const source of ['telemetry', 'positions'] as const) {
        const samples = [
          { latitude: 1, longitude: 1, speed: 0, createdAt: 'start' },
          { latitude: 2, longitude: 2, speed, createdAt: 'end' },
        ];
        const { result, unmount } = setup(drive({
          telemetry: source === 'telemetry' ? samples.map((sample) => tele(sample)) : [],
          positions: source === 'positions' ? samples.map((sample) => pos(sample)) : [],
        }));
        expect(result.current.routeSource[1]).toEqual({
          lat: 2, lng: 2, timestamp: 'end',
        });
        expect('speed' in result.current.routeSource[1]).toBe(false);
        expect(result.current.chartData[1].speed).toBeNull();
        expect(result.current.speedSegments[0]).toEqual({
          positions: [[1, 1], [2, 2]], color: chartTokens.tooltipMutedText,
        });
        expect(result.current.speedHistData).toEqual([
          { range: `${fmtNumber(0)}–${fmtNumber(20)}`, pct: 100 },
        ]);
        unmount();
      }
    },
  );

  it.each([0, -0, -1.25, 0.125, SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS])(
    'preserves measured speed %s without rounding or treating it as unknown',
    (speed) => {
      for (const source of ['telemetry', 'positions'] as const) {
        const samples = [
          { latitude: 1, longitude: 1, speed: 0 },
          { latitude: 2, longitude: 2, speed },
        ];
        const { result, unmount } = setup(drive({
          telemetry: source === 'telemetry' ? samples.map((sample) => tele(sample)) : [],
          positions: source === 'positions' ? samples.map((sample) => pos(sample)) : [],
        }));
        expect(result.current.routeSource[1].speed).toBe(speed);
        expect(result.current.chartData[1].speed).toBeCloseTo(speed * MPS_TO_KMH);
        const color = speed >= SPEED_SEGMENT_HIGH_MPS ? chartTokens.series[3]
          : speed >= SPEED_SEGMENT_MED_MPS ? chartTokens.series[2]
          : speed >= SPEED_SEGMENT_LOW_MPS ? chartTokens.series[0] : chartTokens.series[1];
        expect(result.current.speedSegments[0].color).toBe(color);
        unmount();
      }
    },
  );

  it('does not borrow position speed or timestamps for an unknown telemetry route', () => {
    const { result } = setup(drive({
      telemetry: [
        tele({ latitude: 1, longitude: 1, speed: null, createdAt: 'tele-start' }),
        tele({ latitude: 2, longitude: 2, speed: null, created_at: 'tele-end' }),
      ],
      positions: [pos({ latitude: 3, longitude: 3, speed: 25, createdAt: 'position' })],
    }));
    expect(result.current.routeSource).toEqual([
      { lat: 1, lng: 1, timestamp: 'tele-start' },
      { lat: 2, lng: 2, timestamp: 'tele-end' },
    ]);
    for (const point of result.current.routeSource) {
      expect('speed' in point).toBe(false);
    }
    expect(result.current.speedHistData).toEqual([]);
  });

  it('falls back to original positions when telemetry coordinates are invalid', () => {
    const { result } = setup(drive({
      telemetry: [
        tele({ latitude: NaN, longitude: 1, speed: 10 }),
        tele({ latitude: 91, longitude: 1, speed: 10 }),
      ],
      positions: [
        pos({ latitude: Infinity, longitude: 1 }),
        pos({ latitude: 1, longitude: 181 }),
        pos({ latitude: -1.25, longitude: 0, speed: null, timestamp: 'position' }),
      ],
    }));
    expect(result.current.routeSource).toEqual([
      { lat: -1.25, lng: 0, timestamp: 'position' },
    ]);
    expect('speed' in result.current.routeSource[0]).toBe(false);
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

  it('preserves absent battery/elevation/power/speed as null, not false zero observations', () => {
    const { result } = setup(
      drive({ telemetry: [tele({ latitude: 47.6, longitude: -122.3, createdAt: '08:00' })] }),
    );
    const c = result.current.chartData[0];
    expect(c.speed).toBeNull();
    expect(c.battery).toBeNull();
    expect(c.elevation).toBeNull();
    expect(c.power).toBeNull();
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
    expect(s.efficiencyPctPer100).toBeCloseTo(20, 5); // (80-60)/100km*100
  });

  it('computes energy/regen/power fallbacks when the drive aggregates are absent', () => {
    const { result } = setup(
      drive({
        distanceM: 50000,
        durationS: 3600,
        // maxSpeedMps / avgSpeedMps / avgPowerW / energyUsedWh / regenEnergyWh all null
        telemetry: [
          tele({ latitude: 1, longitude: 1, createdAt: '2024-01-01T08:00:00Z', speed: 5, power: -10 }),
          tele({ latitude: 2, longitude: 2, createdAt: '2024-01-01T08:30:00Z', speed: 10, power: -20 }),
        ],
      }),
      METRIC,
    );
    const s = result.current.stats!;

    expect(s.maxSpd).toBe(0); // no maxSpeedMps
    expect(s.avgSpd).toBe(0); // no avgSpeedMps
    expect(s.powerMax).toBe(-10); // max of [-10,-20]
    expect(s.powerMin).toBe(-20);
    expect(s.avgPower).toBe(-15); // observed time-weighted power over equal half-hour intervals
    expect(s.energyWh).toBeCloseTo(-15000, 5); // signed net pack power * 1h
    expect(s.regenWh).toBeCloseTo(15000, 5); // (10+20) * (1/2) * 1000
    expect(s.minSpd).toBeCloseTo(5 * MPS_TO_KMH, 5); // 18 km/h
  });

  it('retains observed zero power rather than fabricating a peak from avgPowerW', () => {
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
    expect(s.powerMax).toBe(0); // observed zero power; average is not a peak
    expect(s.powerMin).toBe(0);
  });

  it.each([null, NaN, Infinity, -Infinity])('retains unknown energy evidence for invalid power %s', (power) => {
    const input = drive({
      energyUsedWh: power, regenEnergyWh: power, avgPowerW: power,
      telemetry: [tele({ power })],
    });
    const { result } = setup(input);
    const s = result.current.stats!;
    expect(s.energyEvidence).toMatchObject({
      energyWh: null, regenWh: null, energySource: 'missing', regenSource: 'missing',
    });
    expect(driveEnergyEvidence(input, s)).toBe(s.energyEvidence);
    expect(interpretDriveDebrief(s, result.current.chartData, undefined).regenShare).toBeNull();
  });

  it.each([0, -0.25, 0.125])('preserves measured summary energy %s without replacing it with estimates', (energy) => {
    const { result } = setup(drive({
      energyUsedWh: energy, regenEnergyWh: energy, avgPowerW: 8000,
      telemetry: [tele({ power: -10 })],
    }));
    expect(result.current.stats!.energyWh).toBe(energy);
    expect(result.current.stats!.regenWh).toBe(energy);
    expect(result.current.stats!.energyEvidence).toMatchObject({
      energyWh: energy, regenWh: energy, energySource: 'observed', regenSource: 'observed',
    });
  });

  it('recognizes measured zero regen rather than marking it missing', () => {
    const { result } = setup(drive({
      energyUsedWh: 0.25, regenEnergyWh: 0, telemetry: [tele({ power: 0 })],
    }));
    const debrief = interpretDriveDebrief(result.current.stats, result.current.chartData, undefined);
    expect(debrief.regenShare).toBe(0);
    expect(debrief.beats.find((beat) => beat.id === 'regen')?.honesty).toBe('live');
  });

  it.each([NaN, Infinity, -1])('does not estimate energy from invalid duration %s when there is no end instant', (durationS) => {
    const { result } = setup(drive({ durationS, endTs: null, telemetry: [tele({ power: -0.5 })] }));
    expect(result.current.stats!.energyEvidence).toMatchObject({
      energyWh: null, regenWh: null, energySource: 'missing', regenSource: 'missing',
    });
  });

  it('preserves fractional signed estimates and reports their provenance', () => {
    const { result } = setup(drive({
      durationS: 1.8, endTs: '2024-01-01T08:00:01.800Z',
      telemetry: [
        tele({ createdAt: '2024-01-01T08:00:00Z', power: -0.5 }),
        tele({ createdAt: '2024-01-01T08:00:00.900Z', power: 0.25 }),
      ],
    }));
    const s = result.current.stats!;
    expect(s.energyWh).toBeCloseTo(-0.0625);
    expect(s.regenWh).toBeCloseTo(0.125);
    expect(s.energyEvidence).toMatchObject({ energySource: 'estimated', regenSource: 'estimated' });
    const debrief = interpretDriveDebrief(s, result.current.chartData, undefined);
    expect(debrief.regenShare).toBeCloseTo(2);
    expect(debrief.beats.find((beat) => beat.id === 'regen')?.honesty).toBe('guessed');
  });

  it('uses all eligible power observations, including positive and zero, without treating gaps as zero', () => {
    const { result } = setup(drive({
      durationS: 3600,
      telemetry: [-0.5, 0.25, 0, null, NaN, Infinity, -Infinity].map((power, index) => tele({
        power, createdAt: `2024-01-01T08:${String(Math.min(index * 10, 59)).padStart(2, '0')}:00Z`,
      })),
    }));
    expect(result.current.stats!.energyEvidence).toMatchObject({
      powerObservationCount: 3, powerSampleCount: 7,
      energySource: 'estimated', regenSource: 'estimated',
    });
    expect(result.current.stats!.energyEvidence!.energyWh).toBeCloseTo(-250 / 6);
    expect(result.current.stats!.energyEvidence!.regenWh).toBeCloseTo(500 / 6);
    expect(result.current.chartData.map((point) => point.power)).toEqual([-0.5, 0.25, 0, null, null, null, null]);
  });

  it.each([0, 0.25])('keeps nonnegative observed power %s as a known zero regeneration estimate', (power) => {
    const { result } = setup(drive({
      durationS: 3600, telemetry: [
        tele({ createdAt: '2024-01-01T08:00:00Z', power }),
        tele({ createdAt: '2024-01-01T09:00:00Z' }),
      ],
    }));
    expect(result.current.stats!.energyEvidence).toMatchObject({
      energyWh: power * 1000, regenWh: 0,
      powerObservationCount: 1, powerSampleCount: 2, regenSource: 'estimated',
    });
  });

  it('uses eligible position power observations for regeneration coverage', () => {
    const { result } = setup(drive({
      durationS: 3600, positions: [
        pos({ createdAt: '2024-01-01T08:00:00Z', power: -0.5 }),
        pos({ createdAt: '2024-01-01T08:30:00Z', power: 0 }),
        pos({ createdAt: '2024-01-01T09:00:00Z' }),
      ],
    }));
    expect(result.current.stats!.energyEvidence).toMatchObject({
      energyWh: -250, regenWh: 250, powerObservationCount: 2, powerSampleCount: 3,
    });
  });

  it('does not borrow position power when the selected telemetry source has none', () => {
    const { result } = setup(drive({
      telemetry: [tele()], positions: [pos({ power: 10 })],
    }));
    expect(result.current.stats!.energyEvidence).toMatchObject({ energyWh: null, regenWh: null, hasPower: false });
  });

  it('estimates from position power using duration only when telemetry and an end instant are absent', () => {
    const { result } = setup(drive({
      durationS: 1800, endTs: null,
      positions: [pos({ createdAt: '2024-01-01T08:00:00Z', power: -0.25 })],
    }));
    expect(result.current.stats!.energyEvidence).toMatchObject({ energyWh: -125, regenWh: 125, hasPower: true });
  });

  it('does not fabricate regen from average power alone', () => {
    const { result } = setup(drive({ avgPowerW: 0.25 }));
    expect(result.current.stats!.energyEvidence).toMatchObject({ energyWh: 0.25, regenWh: null });
    expect(interpretDriveDebrief(result.current.stats, [], undefined).regenShare).toBeNull();
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
  it('rebuckets raw SI samples when the selected speed unit changes', () => {
    const raw = drive({ telemetry: [tele({ speed: 20 })] });
    const { result, rerender } = setup(raw, METRIC);
    expect(result.current.speedHistData).toEqual([
      { range: `${fmtNumber(60)}–${fmtNumber(80)}`, pct: 100 },
    ]);
    expect(result.current.chartData[0].speed).toBeCloseTo(72);

    H.unitPrefs = IMPERIAL;
    rerender();
    expect(result.current.speedHistData).toEqual([
      { range: `${fmtNumber(40)}–${fmtNumber(60)}`, pct: 100 },
    ]);
    expect(result.current.chartData[0].speed).toBeCloseTo(20 * MPS_TO_MPH);
    expect(result.current.drive?.telemetry?.[0].speed).toBe(20);
  });

  it.each(['telemetry', 'positions'] as const)('excludes missing and invalid %s speeds but counts measured zero', (source) => {
    const speeds = [null, undefined, NaN, Infinity, -Infinity];
    const makeDrive = (values: typeof speeds) => drive(source === 'telemetry'
      ? { telemetry: values.map((speed) => tele({ speed })) }
      : { positions: values.map((speed) => pos({ speed })) });
    const { result, rerender } = setup(makeDrive(speeds));
    expect(result.current.speedHistData).toEqual([]);
    expect(result.current.chartData.map((point) => point.speed)).toEqual(speeds.map(() => null));

    H.drive = makeDrive([...speeds, 0]);
    rerender();
    expect(result.current.speedHistData).toEqual([
      { range: `${fmtNumber(0)}–${fmtNumber(20)}`, pct: 100 },
    ]);
    expect(result.current.chartData.at(-1)?.speed).toBe(0);
  });

  it.each(['telemetry', 'positions'] as const)('retains signed, fractional and open-ended %s observations in the denominator', (source) => {
    for (const prefs of [METRIC, IMPERIAL]) {
      const factor = prefs.speed === 'km/h' ? MPS_TO_KMH : MPS_TO_MPH;
      const speeds = [-0.125, 0, 19.75, 20.25, 10000].map((speed) => speed / factor);
      const raw = drive(source === 'telemetry'
        ? { telemetry: speeds.map((speed) => tele({ speed })) }
        : { positions: speeds.map((speed) => pos({ speed })) });
      const { result, unmount } = setup(raw, prefs);
      expect(result.current.speedHistData).toEqual([
        { range: `<${fmtNumber(0)}`, pct: 20 },
        { range: `${fmtNumber(0)}–${fmtNumber(20)}`, pct: 40 },
        { range: `${fmtNumber(20)}–${fmtNumber(40)}`, pct: 20 },
        { range: `${fmtNumber(120)}+`, pct: 20 },
      ]);
      result.current.chartData.forEach((point, index) => {
        expect(point.speed).toBeCloseTo(speeds[index] * factor);
      });
      expect((source === 'telemetry' ? raw.telemetry : raw.positions)?.map((point) => point.speed)).toEqual(speeds);
      expect(result.current.drive).toBe(raw);
      unmount();
    }
  });

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
