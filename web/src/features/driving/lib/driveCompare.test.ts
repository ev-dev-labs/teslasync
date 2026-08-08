import { describe, expect, it } from 'vitest';
import type { Drive, DriveDetail, DrivePosition, DriveTelemetryPoint } from '@/types/driving';
import {
  compareDrives,
  mergeProfileSeries,
  metricOf,
  normalizeDriveProfile,
  summarizeComparison,
} from './driveCompare';

let nextId = 1;

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: '2026-07-01T08:30:00Z',
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: 400,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: 18,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function telemetry(timestamp: string, speed: number | null, soc: number | null): DriveTelemetryPoint {
  return {
    timestamp,
    speed,
    power: null,
    batteryLevel: soc,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    elevation: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: null,
    fanStatus: null,
    latitude: null,
    longitude: null,
  };
}

function position(timestamp: string, speed: number, batteryLevel = 70): DrivePosition {
  return {
    timestamp,
    latitude: 1,
    longitude: 1,
    speed,
    power: null,
    batteryLevel,
    insideTemp: null,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: null,
    elevation: null,
    fanStatus: null,
    isClimateOn: null,
  };
}

function detail(overrides: Partial<DriveDetail> = {}): DriveDetail {
  return {
    ...drive({
      startTs: '2026-07-01T08:00:00Z',
      endTs: '2026-07-01T08:20:00Z',
      durationS: 1_200,
    }),
    telemetry: [],
    positions: [],
    ...overrides,
  };
}

describe('metricOf', () => {
  it('derives consumption, regen share, and SoC used', () => {
    const item = drive({ energyUsedWh: 2_000, distanceM: 10_000, regenEnergyWh: 400 });
    expect(metricOf(item, 'whPerKm')).toBe(200);
    expect(metricOf(item, 'regenShare')).toBe(0.2);
    expect(metricOf(item, 'socUsed')).toBe(10);
  });

  it('rejects missing, zero-energy, and sub-kilometre ratio inputs', () => {
    expect(metricOf(drive({ energyUsedWh: null }), 'whPerKm')).toBeNull();
    expect(metricOf(drive({ energyUsedWh: 0 }), 'whPerKm')).toBeNull();
    expect(metricOf(drive({ distanceM: 999 }), 'whPerKm')).toBeNull();
    expect(metricOf(drive({ distanceM: 999 }), 'regenShare')).toBeNull();
    expect(metricOf(drive({ startBatteryPct: 60, endBatteryPct: 70 }), 'socUsed')).toBeNull();
    expect(metricOf(drive({ score: 101 }), 'score')).toBeNull();
  });
});

describe('compareDrives fairness', () => {
  it('awards consumption lower, regen share higher, and score higher', () => {
    const a = drive({ energyUsedWh: 1_500, regenEnergyWh: 450, score: 88 });
    const b = drive({ energyUsedWh: 2_500, regenEnergyWh: 250, score: 72 });
    const rows = compareDrives(a, b);
    expect(rows.find((row) => row.key === 'whPerKm')?.winner).toBe('a');
    expect(rows.find((row) => row.key === 'regenShare')?.winner).toBe('a');
    expect(rows.find((row) => row.key === 'score')?.winner).toBe('a');
  });

  it('keeps total energy and absolute battery use neutral across unequal trips', () => {
    const tiny = drive({
      distanceM: 0,
      energyUsedWh: 100,
      startBatteryPct: 80,
      endBatteryPct: 79,
    });
    const normal = drive({
      distanceM: 20_000,
      energyUsedWh: 4_000,
      startBatteryPct: 80,
      endBatteryPct: 60,
    });
    const rows = compareDrives(tiny, normal);
    expect(rows.find((row) => row.key === 'energyUsedWh')?.winner).toBeNull();
    expect(rows.find((row) => row.key === 'socUsed')?.winner).toBeNull();
    expect(rows.find((row) => row.key === 'whPerKm')?.winner).toBeNull();
  });

  it('does not award noisy regen share when either trip is under one kilometre', () => {
    const tiny = drive({ distanceM: 500, energyUsedWh: 20, regenEnergyWh: 19 });
    const normal = drive({ distanceM: 10_000, energyUsedWh: 2_000, regenEnergyWh: 200 });
    expect(compareDrives(tiny, normal).find((row) => row.key === 'regenShare')?.winner).toBeNull();
  });

  it('leaves neutral metrics, ties, and missing pairs unbadged', () => {
    const rows = compareDrives(
      drive({ distanceM: 10_000, energyUsedWh: null }),
      drive({ distanceM: 50_000 }),
    );
    expect(rows.find((row) => row.key === 'distanceM')?.winner).toBeNull();
    expect(rows.find((row) => row.key === 'whPerKm')?.winner).toBeNull();
    expect(compareDrives(drive({}), drive({})).every((row) => row.winner === null)).toBe(true);
  });

  it('emits every metric in stable presentation order', () => {
    expect(compareDrives(drive({}), drive({})).map((row) => row.key)).toEqual([
      'distanceM',
      'durationS',
      'avgSpeedMps',
      'maxSpeedMps',
      'energyUsedWh',
      'whPerKm',
      'regenShare',
      'socUsed',
      'outsideTempAvgC',
      'score',
    ]);
  });
});

describe('summarizeComparison', () => {
  it('builds a verdict only from fair directional rows', () => {
    const rows = compareDrives(
      drive({ energyUsedWh: 1_500, regenEnergyWh: 450, score: 65 }),
      drive({ energyUsedWh: 2_000, regenEnergyWh: 200, score: 80 }),
    );
    expect(summarizeComparison(rows)).toEqual({
      verdict: 'a',
      aWins: 2,
      bWins: 1,
      ties: 0,
      comparableCount: 3,
    });
  });

  it('distinguishes a real tie from insufficient data', () => {
    const tied = summarizeComparison(compareDrives(
      drive({ energyUsedWh: 2_000, regenEnergyWh: 400, score: 80 }),
      drive({ energyUsedWh: 2_000, regenEnergyWh: 400, score: 80 }),
    ));
    expect(tied.verdict).toBe('tie');
    expect(tied.comparableCount).toBe(3);

    const insufficient = summarizeComparison(compareDrives(
      drive({ distanceM: 0, energyUsedWh: 100, score: null }),
      drive({ distanceM: 0, energyUsedWh: 50, score: null }),
    ));
    expect(insufficient).toMatchObject({ verdict: 'insufficient', comparableCount: 0 });
  });
});

describe('normalizeDriveProfile', () => {
  it('maps different-duration telemetry to deterministic trip progress', () => {
    const profile = normalizeDriveProfile(detail({
      telemetry: [
        telemetry('2026-07-01T08:00:00Z', 0, 80),
        telemetry('2026-07-01T08:10:00Z', 10, 75),
        telemetry('2026-07-01T08:20:00Z', 20, 70),
      ],
    }));
    expect(profile.speed).toEqual([
      { progress: 0, value: 0 },
      { progress: 50, value: 10 },
      { progress: 100, value: 20 },
    ]);
    expect(profile.soc.map((point) => point.progress)).toEqual([0, 50, 100]);
  });

  it('falls back to positions for speed and rejects invalid samples', () => {
    const profile = normalizeDriveProfile(detail({
      telemetry: [
        telemetry('2026-07-01T08:00:00Z', null, 80),
        telemetry('bad timestamp', 99, 150),
        telemetry('2026-07-01T08:20:00Z', null, 70),
      ],
      positions: [
        position('2026-07-01T08:00:00Z', 2),
        position('2026-07-01T08:20:00Z', 12),
      ],
    }));
    expect(profile.speed).toEqual([
      { progress: 0, value: 2 },
      { progress: 100, value: 12 },
    ]);
    expect(profile.soc.map((point) => point.value)).toEqual([80, 70]);
  });

  it('merges original A/B sample positions without inventing values', () => {
    expect(mergeProfileSeries(
      [{ progress: 0, value: 1 }, { progress: 100, value: 2 }],
      [{ progress: 0, value: 3 }, { progress: 50, value: 4 }],
    )).toEqual([
      { progress: 0, a: 1, b: 3 },
      { progress: 50, a: null, b: 4 },
      { progress: 100, a: 2, b: null },
    ]);
  });
});
