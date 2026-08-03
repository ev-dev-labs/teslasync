import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import { computeChargeAdvice, RESERVE_FLOOR_PCT } from './chargeAdvisor';

let nextId = 1;

/** Drive on a LOCAL date consuming `burn` percent of battery. */
function driveOn(local: Date, burn: number): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: local.toISOString(),
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 70,
    endBatteryPct: 70 - burn,
    energyUsedWh: 2000,
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
  };
}

// Four consecutive local Mondays plus the now-reference right after them.
const MONDAYS = [new Date(2026, 5, 8, 9), new Date(2026, 5, 15, 9), new Date(2026, 5, 22, 9), new Date(2026, 5, 29, 9)];
const NOW = new Date(2026, 5, 30, 8).getTime(); // a Tuesday morning

describe('computeChargeAdvice', () => {
  it('sums multiple drives on one day and takes the weekday median', () => {
    const drives = [
      driveOn(MONDAYS[0]!, 5), driveOn(MONDAYS[0]!, 5), // one 10% Monday
      driveOn(MONDAYS[1]!, 20),
      driveOn(MONDAYS[2]!, 30),
    ];
    const advice = computeChargeAdvice(drives, 80, NOW);
    expect(advice.weekdayBurn[1]!.medianPct).toBe(20); // median of 10, 20, 30
    expect(advice.analyzedDays).toBe(3);
  });

  it('projects the SoC forward and flags the reserve crossing', () => {
    // 30% burned on every observed driving day. Weekday medians are scaled by
    // how often each weekday is actually driven (and unseen weekdays fall
    // back to the pooled median × pooled frequency), so from 80% the 20%
    // floor is crossed within the 7-day horizon.
    const drives = [
      ...MONDAYS.map((m) => driveOn(m, 30)),
      driveOn(new Date(2026, 5, 23, 9), 30), // a Tuesday
      driveOn(new Date(2026, 5, 24, 9), 30), // a Wednesday
    ];
    const advice = computeChargeAdvice(drives, 80, NOW);
    expect(advice.forecast.length).toBe(7);
    expect(advice.daysToReserve).not.toBeNull();
    expect(advice.daysToReserve!).toBeLessThanOrEqual(6);
    expect(advice.forecast.every((f, i, arr) => i === 0 || f.projectedEndPct <= arr[i - 1]!.projectedEndPct)).toBe(true);
  });

  it('does not recommend charging when SoC is comfortable', () => {
    const drives = [...MONDAYS.map((m) => driveOn(m, 3)), driveOn(new Date(2026, 5, 24, 9), 3)];
    const advice = computeChargeAdvice(drives, 90, NOW);
    expect(advice.daysToReserve).toBeNull();
    expect(advice.chargeTonight).toBe(false);
  });

  it('withholds the forecast without current SoC or enough history', () => {
    const noSoc = computeChargeAdvice(MONDAYS.map((m) => driveOn(m, 10)), null, NOW);
    expect(noSoc.forecast).toEqual([]);
    const thin = computeChargeAdvice([driveOn(MONDAYS[0]!, 10)], 80, NOW);
    expect(thin.forecast).toEqual([]);
  });

  it('ignores drives without SoC data or with SoC gains', () => {
    const charged = driveOn(MONDAYS[0]!, -5); // end > start (charged mid-drive)
    const missing = { ...driveOn(MONDAYS[1]!, 10), startBatteryPct: null };
    const advice = computeChargeAdvice([charged, missing, driveOn(MONDAYS[2]!, 10)], 80, NOW);
    expect(advice.analyzedDays).toBe(1);
  });

  it('exports a 20% reserve floor', () => {
    expect(RESERVE_FLOOR_PCT).toBe(20);
  });
});
