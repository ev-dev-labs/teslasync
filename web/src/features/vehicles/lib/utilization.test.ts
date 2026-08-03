import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { summarizeUtilization } from './utilization';

let nextId = 1;

function drive(local: Date, over: Partial<Drive> = {}): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: local.toISOString(),
    endTs: null,
    durationS: 3600,
    distanceM: 50_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 10_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('summarizeUtilization', () => {
  // Window: first drive on day 0, now = 10 days later.
  const D0 = new Date(2026, 6, 10, 8);
  const NOW = new Date(2026, 6, 20, 8).getTime();

  it('measures driving share against the observed window', () => {
    // Two 1-hour drives over a 10-day window → 2 / 240 hours.
    const s = summarizeUtilization([drive(D0), drive(new Date(2026, 6, 15, 8))], null, NOW);
    expect(s.observedDays).toBeCloseTo(10, 0);
    expect(s.drivingHours).toBeCloseTo(2);
    expect(s.drivingShare).toBeCloseTo(2 / 240, 3);
    expect(s.activeDayShare).toBeCloseTo(0.2, 1);
  });

  it('prices energy per km and per driving hour', () => {
    // 100 km, 20 kWh, $0.10/kWh → $2 total; $0.02/km; $1/driving-hour.
    const s = summarizeUtilization([drive(D0), drive(new Date(2026, 6, 15, 8))], 0.1, NOW);
    expect(s.totalEnergyCost).toBeCloseTo(2);
    expect(s.costPerKm).toBeCloseTo(0.02);
    expect(s.costPerDrivingHour).toBeCloseTo(1);
  });

  it('returns nulls for cost without a rate', () => {
    const s = summarizeUtilization([drive(D0)], null, NOW);
    expect(s.totalEnergyCost).toBeNull();
    expect(s.costPerKm).toBeNull();
    expect(s.costPerDrivingHour).toBeNull();
  });

  it('averages distance per observed day', () => {
    const s = summarizeUtilization([drive(D0), drive(new Date(2026, 6, 15, 8))], null, NOW);
    expect(s.distancePerDayM).toBeCloseTo(10_000, -2);
  });

  it('handles empty input and clock-before-first-drive', () => {
    expect(summarizeUtilization([], 0.1, NOW).observedDays).toBeNull();
    const s = summarizeUtilization([drive(D0)], 0.1, D0.getTime() - 1000);
    expect(s.observedDays).toBeNull();
  });
});
