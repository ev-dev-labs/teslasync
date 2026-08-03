import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { compareDrives, metricOf } from './driveCompare';

let nextId = 1;

function drive(over: Partial<Drive>): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2000,
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
    ...over,
  };
}

describe('metricOf', () => {
  it('derives consumption, regen share, and SoC used', () => {
    const d = drive({ energyUsedWh: 2000, distanceM: 10_000, regenEnergyWh: 400 });
    expect(metricOf(d, 'whPerKm')).toBe(200);
    expect(metricOf(d, 'regenShare')).toBe(0.2);
    expect(metricOf(d, 'socUsed')).toBe(10);
  });

  it('returns null for underivable metrics', () => {
    expect(metricOf(drive({ energyUsedWh: null }), 'whPerKm')).toBeNull();
    expect(metricOf(drive({ distanceM: 500 }), 'whPerKm')).toBeNull();
    expect(metricOf(drive({ startBatteryPct: 60, endBatteryPct: 70 }), 'socUsed')).toBeNull();
    expect(metricOf(drive({ outsideTempAvgC: null }), 'outsideTempAvgC')).toBeNull();
  });
});

describe('compareDrives', () => {
  it('awards lower-is-better metrics to the lower side', () => {
    const a = drive({ energyUsedWh: 1500 });
    const b = drive({ energyUsedWh: 2500 });
    const row = compareDrives(a, b).find((r) => r.key === 'energyUsedWh')!;
    expect(row.winner).toBe('a');
  });

  it('awards higher-is-better metrics to the higher side', () => {
    const a = drive({ regenEnergyWh: 100 });
    const b = drive({ regenEnergyWh: 600 });
    const row = compareDrives(a, b).find((r) => r.key === 'regenShare')!;
    expect(row.winner).toBe('b');
  });

  it('leaves neutral metrics and ties without a winner', () => {
    const a = drive({ distanceM: 10_000 });
    const b = drive({ distanceM: 50_000 });
    const rows = compareDrives(a, b);
    expect(rows.find((r) => r.key === 'distanceM')!.winner).toBeNull();
    const tie = compareDrives(drive({}), drive({}));
    expect(tie.every((r) => r.winner === null)).toBe(true);
  });

  it('never crowns a winner when a side is missing', () => {
    const rows = compareDrives(drive({ energyUsedWh: null }), drive({}));
    expect(rows.find((r) => r.key === 'energyUsedWh')!.winner).toBeNull();
    expect(rows.find((r) => r.key === 'whPerKm')!.winner).toBeNull();
  });

  it('emits one row per metric in a stable order', () => {
    const keys = compareDrives(drive({}), drive({})).map((r) => r.key);
    expect(keys).toEqual([
      'distanceM', 'durationS', 'avgSpeedMps', 'maxSpeedMps',
      'energyUsedWh', 'whPerKm', 'regenShare', 'socUsed', 'outsideTempAvgC',
    ]);
  });
});
