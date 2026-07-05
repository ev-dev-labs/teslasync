/**
 * `constants.ts` holds the three SI (m/s) speed edges that band the drive
 * route map. They live at the intersection of two consumers that MUST agree:
 *
 *   1. `useDriveDetailData` compares raw telemetry m/s against them to paint
 *      each segment green → cyan → amber → red.
 *   2. `RouteMapSection` runs them back through `convertSpeedFromSI` so the
 *      legend prints the same edges in the user's display unit.
 *
 * A silent digit slip, a sign flip, or an ordering swap would mis-colour the
 * map or mislabel the legend with no type error to catch it — so this suite
 * pins the physical meaning of each edge, its exact round-trip through the real
 * display converter, and its wiring into the actual segment-colouring code in
 * `useDriveDetailData` (rather than asserting the literals back to themselves).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DriveDetail, DriveTelemetryPoint } from '@/types/driving';
import type { SpeedUnitPref } from '@/lib/unitConversion';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import {
  SPEED_SEGMENT_LOW_MPS,
  SPEED_SEGMENT_MED_MPS,
  SPEED_SEGMENT_HIGH_MPS,
} from './constants';
import { useDriveDetailData } from './useDriveDetailData';

/** Exact mph → m/s factor, re-derived here so the test never imports the SUT's copy. */
const MPS_PER_MPH = 1609.344 / 3600;

/** The literal hex colours the real segment painter assigns per band. */
const GREEN = '#10b981';
const CYAN = '#00f0ff';
const AMBER = '#f59e0b';
const RED = '#ef4444';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const mocks = vi.hoisted(() => ({
  drive: null as unknown,
  speed: 'mph' as SpeedUnitPref,
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrive: () => ({ data: mocks.drive, isLoading: false, error: null }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicle: () => ({ data: null }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: mocks.speed === 'mph' ? 'mi' : 'km',
      speed: mocks.speed,
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: 1,
    },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v ?? '') }),
}));

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function makeTele(speed: number, lat: number, lng: number): DriveTelemetryPoint {
  return {
    timestamp: '2025-03-01T10:00:00Z',
    speed,
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
    latitude: lat,
    longitude: lng,
  };
}

function makeDrive(telemetry: DriveTelemetryPoint[]): DriveDetail {
  return {
    id: 42,
    vehicleId: 1,
    startTs: '2025-03-01T10:00:00Z',
    endTs: '2025-03-01T10:45:00Z',
    durationS: 2700,
    distanceM: 32000,
    startAddress: 'A',
    endAddress: 'B',
    startLat: 47.6,
    startLon: -122.3,
    endLat: 47.44,
    endLon: -122.3,
    startBatteryPct: 82,
    endBatteryPct: 68,
    energyUsedWh: 7200,
    regenEnergyWh: 900,
    avgSpeedMps: 20,
    maxSpeedMps: 31,
    avgPowerW: 15000,
    outsideTempAvgC: 14,
    insideTempAvgC: 21,
    score: 88,
    endedStatus: 'parked',
    createdAt: '2025-03-01T10:45:05Z',
    updatedAt: '2025-03-01T10:45:05Z',
    positions: [],
    telemetry,
  };
}

/** Render `useDriveDetailData` against a synthetic telemetry route. */
function renderWithRoute(telemetry: DriveTelemetryPoint[], speed: SpeedUnitPref = 'mph') {
  mocks.drive = makeDrive(telemetry);
  mocks.speed = speed;
  return renderHook(() => useDriveDetailData('42'));
}

beforeEach(() => {
  mocks.drive = null;
  mocks.speed = 'mph';
});

/* ── The SI magnitudes + ordering invariant ───────────────────────────────── */
describe('drive-detail speed constants — SI magnitude & ordering', () => {
  const EDGES = [SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS];

  it('exposes a finite, strictly positive m/s magnitude for every edge', () => {
    expect(EDGES).toHaveLength(3);
    for (const v of EDGES) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('keeps the edges strictly ascending so the colour ladder cannot mis-band', () => {
    // The whole green→cyan→amber→red branch order in useDriveDetailData relies
    // on LOW < MED < HIGH; guard it explicitly.
    expect(SPEED_SEGMENT_LOW_MPS).toBeLessThan(SPEED_SEGMENT_MED_MPS);
    expect(SPEED_SEGMENT_MED_MPS).toBeLessThan(SPEED_SEGMENT_HIGH_MPS);
    const sorted = [...EDGES].sort((a, b) => a - b);
    expect(EDGES).toEqual(sorted);
  });

  it('pins each edge to its exact 30 / 60 / 100 mph value in SI m/s', () => {
    expect(SPEED_SEGMENT_LOW_MPS).toBeCloseTo(30 * MPS_PER_MPH, 9);
    expect(SPEED_SEGMENT_MED_MPS).toBeCloseTo(60 * MPS_PER_MPH, 9);
    expect(SPEED_SEGMENT_HIGH_MPS).toBeCloseTo(100 * MPS_PER_MPH, 9);
    // Concrete SI figures (30 mph = 13.4112 m/s, etc.).
    expect(SPEED_SEGMENT_LOW_MPS).toBeCloseTo(13.4112, 6);
    expect(SPEED_SEGMENT_MED_MPS).toBeCloseTo(26.8224, 6);
    expect(SPEED_SEGMENT_HIGH_MPS).toBeCloseTo(44.704, 6);
  });

  it('preserves the 30/60/100 mph ratios between the edges', () => {
    expect(SPEED_SEGMENT_MED_MPS / SPEED_SEGMENT_LOW_MPS).toBeCloseTo(2, 12);
    expect(SPEED_SEGMENT_HIGH_MPS / SPEED_SEGMENT_LOW_MPS).toBeCloseTo(10 / 3, 12);
  });
});

/* ── Legend round-trip through the REAL display converter ──────────────────── */
describe('drive-detail speed constants — legend round-trip via convertSpeedFromSI', () => {
  it('renders as clean 30 / 60 / 100 for an mph user', () => {
    expect(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'mph')).toBeCloseTo(30, 6);
    expect(convertSpeedFromSI(SPEED_SEGMENT_MED_MPS, 'mph')).toBeCloseTo(60, 6);
    expect(convertSpeedFromSI(SPEED_SEGMENT_HIGH_MPS, 'mph')).toBeCloseTo(100, 6);
    // The legend rounds to whole numbers — they must land on the intended marks.
    expect(Math.round(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'mph'))).toBe(30);
    expect(Math.round(convertSpeedFromSI(SPEED_SEGMENT_HIGH_MPS, 'mph'))).toBe(100);
  });

  it('renders the metric equivalents for a km/h user', () => {
    // 30/60/100 mph → 48.28 / 96.56 / 160.93 km/h.
    expect(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'km/h')).toBeCloseTo(48.28032, 4);
    expect(convertSpeedFromSI(SPEED_SEGMENT_MED_MPS, 'km/h')).toBeCloseTo(96.56064, 4);
    expect(convertSpeedFromSI(SPEED_SEGMENT_HIGH_MPS, 'km/h')).toBeCloseTo(160.9344, 4);
    // km/h magnitudes must exceed the mph ones for the identical SI input.
    expect(convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'km/h')).toBeGreaterThan(
      convertSpeedFromSI(SPEED_SEGMENT_LOW_MPS, 'mph'),
    );
  });
});

/* ── Wired through the REAL segment-colouring consumer ─────────────────────── */
describe('drive-detail speed constants — segment colouring in useDriveDetailData', () => {
  it('bands a mixed-speed route green → cyan → amber → red across every edge', () => {
    // curr.speed of each segment (i>=1) drives its colour. Points straddle each
    // band, including exact-boundary samples that must fall in the HIGHER band
    // because the comparisons are inclusive (>=).
    const route = [
      makeTele(0, 47.6, -122.3), // anchor (never a segment's curr)
      makeTele(5, 47.61, -122.3), //          < LOW            → green
      makeTele(SPEED_SEGMENT_LOW_MPS, 47.62, -122.3), // == LOW → cyan (>=)
      makeTele(20, 47.63, -122.3), //          LOW..MED         → cyan
      makeTele(SPEED_SEGMENT_MED_MPS, 47.64, -122.3), // == MED → amber (>=)
      makeTele(35, 47.65, -122.3), //          MED..HIGH        → amber
      makeTele(SPEED_SEGMENT_HIGH_MPS, 47.66, -122.3), // == HIGH → red (>=)
      makeTele(50, 47.67, -122.3), //          > HIGH           → red
    ];

    const { result } = renderWithRoute(route);
    const segments = result.current.speedSegments;

    expect(segments).toHaveLength(route.length - 1);
    expect(segments.map((s) => s.color)).toEqual([
      GREEN,
      CYAN,
      CYAN,
      AMBER,
      AMBER,
      RED,
      RED,
    ]);
    // Boundary samples land in the higher band, proving inclusive thresholds.
    expect(segments[1].color).toBe(CYAN); // exactly LOW
    expect(segments[3].color).toBe(AMBER); // exactly MED
    expect(segments[5].color).toBe(RED); // exactly HIGH
    // Each segment stitches the previous point to the current one.
    expect(segments[0].positions).toEqual([
      [47.6, -122.3],
      [47.61, -122.3],
    ]);
  });

  it('paints a wholly-slow route green — nothing reaches the LOW edge', () => {
    const belowLow = SPEED_SEGMENT_LOW_MPS - 0.01;
    const { result } = renderWithRoute([
      makeTele(1, 47.6, -122.3),
      makeTele(belowLow, 47.61, -122.3),
      makeTele(0, 47.62, -122.3),
    ]);
    const colors = result.current.speedSegments.map((s) => s.color);
    expect(colors).toEqual([GREEN, GREEN]);
    expect(colors).not.toContain(RED);
  });

  it('computes colours from SI telemetry independently of the display unit', () => {
    // The same route rendered for an mph user and a km/h user must yield the
    // SAME colours — segment banding reads raw SI, never the display preference.
    const route = [
      makeTele(0, 47.6, -122.3),
      makeTele(20, 47.61, -122.3), // cyan
      makeTele(35, 47.62, -122.3), // amber
      makeTele(50, 47.63, -122.3), // red
    ];
    const mph = renderWithRoute(route, 'mph').result.current.speedSegments.map((s) => s.color);
    const kmh = renderWithRoute(route, 'km/h').result.current.speedSegments.map((s) => s.color);

    expect(mph).toEqual([CYAN, AMBER, RED]);
    expect(kmh).toEqual(mph);
  });

  it('yields no segments for a single-point (stationary) route', () => {
    const { result } = renderWithRoute([makeTele(42, 47.6, -122.3)]);
    expect(result.current.speedSegments).toEqual([]);
  });
});
