import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  computeMileageBudget,
  isValidBudgetConfig,
  type MileageBudgetConfig,
} from './mileageBudget';

let nextId = 1;

function drive(startTs: string, distanceM: number): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs,
    endTs: null,
    durationS: 1800,
    distanceM,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
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

const CONFIG: MileageBudgetConfig = {
  annualAllowanceKm: 12_000,
  termStartIso: '2026-01-01',
  termMonths: 12,
  overagePerKm: 0.2,
};

describe('isValidBudgetConfig', () => {
  it('accepts a sane config and rejects broken ones', () => {
    expect(isValidBudgetConfig(CONFIG)).toBe(true);
    expect(isValidBudgetConfig({ ...CONFIG, annualAllowanceKm: 0 })).toBe(false);
    expect(isValidBudgetConfig({ ...CONFIG, termMonths: 0 })).toBe(false);
    expect(isValidBudgetConfig({ ...CONFIG, overagePerKm: -1 })).toBe(false);
    expect(isValidBudgetConfig({ ...CONFIG, termStartIso: 'nope' })).toBe(false);
  });
});

describe('computeMileageBudget', () => {
  it('sums only in-term drives', () => {
    const now = new Date(2026, 6, 1).getTime(); // 2026-07-01 local
    const r = computeMileageBudget(
      [
        drive('2025-12-31T10:00:00Z', 999_000), // before term
        drive('2026-02-10T10:00:00Z', 500_000),
        drive('2026-03-10T10:00:00Z', 250_000),
        drive('2027-02-01T10:00:00Z', 999_000), // after term
      ],
      CONFIG,
      now,
    );
    expect(r.usedM).toBe(750_000);
    expect(r.totalAllowanceM).toBe(12_000_000);
  });

  it('pro-rates the allowance and reports pace', () => {
    const now = new Date(2026, 6, 1).getTime();
    const r = computeMileageBudget([drive('2026-02-10T10:00:00Z', 6_000_000)], CONFIG, now);
    // ~half the year elapsed → allowed ≈ 6,000 km, used 6,000 km → pace ≈ 1.
    expect(r.allowedToDateM).toBeGreaterThan(5_800_000);
    expect(r.allowedToDateM).toBeLessThan(6_200_000);
    expect(r.paceRatio).toBeGreaterThan(0.95);
    expect(r.paceRatio).toBeLessThan(1.05);
  });

  it('projects the term-end total linearly with overage cost', () => {
    const now = new Date(2026, 6, 1).getTime();
    // 9,000 km at ~half term → ~18,000 km projected → ~6,000 km over → ~$1,200.
    const r = computeMileageBudget([drive('2026-02-10T10:00:00Z', 9_000_000)], CONFIG, now);
    expect(r.projectedTotalM).not.toBeNull();
    expect(r.projectedTotalM!).toBeGreaterThan(17_000_000);
    expect(r.projectedTotalM!).toBeLessThan(19_000_000);
    expect(r.projectedOverageM).toBeGreaterThan(5_000_000);
    expect(r.projectedOverageCost).toBeGreaterThan(1_000);
    expect(r.projectedOverageCost).toBeLessThan(1_500);
  });

  it('withholds the projection in the first week of a term', () => {
    const now = new Date(2026, 0, 3).getTime(); // day 2 of the term
    const r = computeMileageBudget([drive('2026-01-02T10:00:00Z', 100_000)], CONFIG, now);
    expect(r.projectedTotalM).toBeNull();
    expect(r.projectedOverageM).toBe(0);
  });

  it('builds a cumulative monthly series up to now', () => {
    const now = new Date(2026, 2, 15).getTime(); // mid-March
    const r = computeMileageBudget(
      [drive('2026-01-10T10:00:00Z', 1_000_000), drive('2026-02-10T10:00:00Z', 500_000)],
      CONFIG,
      now,
    );
    expect(r.monthly.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.monthly[0]!.usedKm).toBe(1000);
    expect(r.monthly[1]!.usedKm).toBe(1500);
    expect(r.monthly[2]!.usedKm).toBe(1500);
    // Allowance accrues monotonically.
    expect(r.monthly[1]!.allowedKm).toBeGreaterThan(r.monthly[0]!.allowedKm);
  });

  it('clamps a now beyond the term end', () => {
    const now = new Date(2030, 0, 1).getTime();
    const r = computeMileageBudget([drive('2026-02-10T10:00:00Z', 1_000_000)], CONFIG, now);
    expect(r.remainingDays).toBe(0);
    expect(r.elapsedDays).toBe(r.totalDays);
  });

  it('flags a capped history response so full-term claims can be withheld', () => {
    const now = new Date(2026, 6, 1).getTime();
    const capped = computeMileageBudget(
      [
        drive('2026-02-10T10:00:00Z', 1_000_000),
        drive('2026-03-10T10:00:00Z', 1_000_000),
      ],
      CONFIG,
      now,
      2,
    );
    const uncapped = computeMileageBudget(
      [drive('2026-02-10T10:00:00Z', 1_000_000)],
      CONFIG,
      now,
      2,
    );

    expect(capped.historyLimit).toBe(2);
    expect(capped.historyCapReached).toBe(true);
    expect(uncapped.historyCapReached).toBe(false);
    expect(() =>
      computeMileageBudget([], CONFIG, now, 0),
    ).toThrow('historyLimit must be a positive integer');
  });
});
