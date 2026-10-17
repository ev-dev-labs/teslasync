import { afterEach, describe, it, expect, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';
import { formatDate } from '@/lib/dateFormat';
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
  const originalLocale = getGlobalLocale();

  afterEach(() => {
    vi.unstubAllEnvs();
    setGlobalLocale(originalLocale);
  });

  it.each([
    ['2026-01-31', 1, 2026, 1, 28, 28],
    ['2024-01-31', 1, 2024, 1, 29, 29],
    ['2026-01-30', 1, 2026, 1, 28, 29],
    ['2026-01-31', 2, 2026, 2, 31, 59],
    ['2026-04-30', 1, 2026, 4, 30, 30],
    ['2024-02-29', 12, 2025, 1, 28, 365],
    ['2026-12-31', 1, 2027, 0, 31, 31],
  ])('adds calendar months to %s without overflowing (%i months)', (termStartIso, termMonths, year, month, day, totalDays) => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const end = new Date(year, month, day).getTime();
    const result = computeMileageBudget(
      [],
      { ...CONFIG, termStartIso, termMonths },
      end,
    );

    expect(result.termEndMs).toBe(end);
    expect(result.totalDays).toBe(totalDays);
    expect(result.elapsedDays).toBe(totalDays);
    expect(result.remainingDays).toBe(0);
    expect(result.allowedToDateM).toBe(result.totalAllowanceM);
    expect(result.monthly.at(-1)?.allowedKm).toBe(result.totalAllowanceM / 1000);
  });

  it('uses the clamped month interval for range, prorating and forecast with saved display preferences', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    setGlobalLocale('de-DE');
    const savedDisplayPreferences = { locale: getGlobalLocale(), tz: 'Asia/Tokyo' };
    const config = { ...CONFIG, termStartIso: '2026-01-31', termMonths: 1 };
    const end = new Date(2026, 1, 28).getTime();
    const rows = [
      drive('2026-01-31T07:59:59.999Z', 999_000),
      drive('2026-01-31T08:00:00Z', 200_000),
      drive('2026-02-28T07:59:59.999Z', 300_000),
      drive('2026-02-28T08:00:00Z', 999_000),
      drive('2026-03-01T08:00:00Z', 999_000),
      drive('invalid', 999_000),
      drive('', 999_000),
    ];
    const halfway = computeMileageBudget(rows.slice(0, 2), config, new Date(2026, 1, 14).getTime());
    expect(halfway.totalDays).toBe(28);
    expect(halfway.elapsedDays).toBe(14);
    expect(halfway.allowedToDateM).toBe(500_000);
    expect(halfway.projectedTotalM).toBe(400_000);

    const result = computeMileageBudget(rows, config, end);
    expect(result.termEndMs).toBe(Date.parse('2026-02-28T08:00:00Z'));
    expect(result.usedM).toBe(500_000);
    expect(result.projectedTotalM).toBe(500_000);
    expect(result.monthly.map(({ month }) => month)).toEqual(['2026-01', '2026-02']);
    expect(result.monthly.at(-1)).toEqual({ month: '2026-02', usedKm: 500, allowedKm: 1000 });
    expect(formatDate(end, savedDisplayPreferences)).toBe(
      new Date(end).toLocaleDateString('de-DE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric',
      }),
    );
  });

  it.each(['2026-02-28', '2026-10-31'])('finishes pacing on the same interval across DST from %s', (termStartIso) => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const config = { ...CONFIG, termStartIso, termMonths: 1 };
    const start = new Date(`${termStartIso}T00:00:00`).getTime();
    const end = termStartIso === '2026-02-28'
      ? new Date(2026, 2, 28).getTime()
      : new Date(2026, 10, 30).getTime();
    const rows = [drive(new Date(start).toISOString(), 500_000)];
    const halfway = computeMileageBudget(rows, config, start + (end - start) / 2);
    expect(halfway.allowedToDateM).toBe(500_000);
    expect(halfway.projectedTotalM).toBe(1_000_000);
    const result = computeMileageBudget(rows, config, end);
    expect(result.termEndMs).toBe(end);
    expect(result.elapsedDays).toBe(result.totalDays);
    expect(result.remainingDays).toBe(0);
    expect(result.allowedToDateM).toBe(result.totalAllowanceM);
    expect(result.projectedTotalM).toBe(result.usedM);
    expect(result.monthly.at(-1)?.allowedKm).toBe(1000);
  });

  it('uses the existing local business calendar at term and month day boundaries', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const r = computeMileageBudget(
      [
        drive('2026-01-01T07:59:59.999Z', 999_000),
        drive('2026-01-01T08:00:00Z', 100_000),
        drive('2026-02-01T07:59:59.999Z', 200_000),
        drive('2026-02-01T08:00:00Z', 300_000),
        drive('2027-01-01T07:59:59.999Z', 400_000),
        drive('2027-01-01T08:00:00Z', 999_000),
      ],
      CONFIG,
      new Date(2027, 0, 1).getTime(),
    );

    expect(r.termStartMs).toBe(Date.parse('2026-01-01T08:00:00Z'));
    expect(r.termEndMs).toBe(Date.parse('2027-01-01T08:00:00Z'));
    expect(r.usedM).toBe(1_000_000);
    expect(r.monthly[0]).toMatchObject({ month: '2026-01', usedKm: 300 });
    expect(r.monthly[1]).toMatchObject({ month: '2026-02', usedKm: 600 });
    expect(r.monthly[11]).toMatchObject({ month: '2026-12', usedKm: 1000 });
  });

  it('buckets equivalent offset timestamps from their instant, including across DST', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const r = computeMileageBudget(
      [
        drive('2026-03-01T00:30:00Z', 100_000),
        drive('2026-02-28T16:30:00-08:00', 100_000),
        drive('2026-04-01T06:59:59Z', 200_000),
        drive('2026-03-31T23:59:59-07:00', 200_000),
        drive('2026-04-01T07:00:00Z', 300_000),
      ],
      CONFIG,
      new Date(2026, 3, 15).getTime(),
    );

    expect(r.monthly.map(({ month, usedKm }) => ({ month, usedKm }))).toEqual([
      { month: '2026-01', usedKm: 0 },
      { month: '2026-02', usedKm: 200 },
      { month: '2026-03', usedKm: 600 },
      { month: '2026-04', usedKm: 900 },
    ]);
  });

  it('keeps business periods and keys independent of non-default saved display preferences', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const rows = [drive('2026-02-01T07:30:00Z', 100_000)];
    const now = new Date(2026, 1, 15).getTime();
    const baseline = computeMileageBudget(rows, CONFIG, now);
    setGlobalLocale('de-DE');
    const savedDisplayPreferences = { locale: getGlobalLocale(), tz: 'Asia/Tokyo' };
    const result = computeMileageBudget(rows, CONFIG, now);

    expect(result).toEqual(baseline);
    expect(result.monthly[0]).toMatchObject({ month: '2026-01', usedKm: 100 });
    expect(formatDate(rows[0]!.startTs, savedDisplayPreferences)).toBe(
      new Date(rows[0]!.startTs).toLocaleDateString('de-DE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric',
      }),
    );
    expect(new Date(result.termStartMs).getDate()).toBe(1);
    expect(new Date(result.termEndMs).getDate()).toBe(1);
  });

  it('excludes invalid, empty and missing drive dates from both totals and buckets', () => {
    const missingDate = drive('', 999_000);
    Reflect.deleteProperty(missingDate, 'startTs');
    const nullDate = drive('', 999_000);
    Reflect.set(nullDate, 'startTs', null);
    const r = computeMileageBudget(
      [
        drive('invalid', 999_000),
        drive('', 999_000),
        missingDate,
        nullDate,
        drive('2026-02-10T10:00:00Z', 100_000),
      ],
      CONFIG,
      new Date(2026, 2, 15).getTime(),
    );

    expect(r.usedM).toBe(100_000);
    expect(r.monthly.map((point) => point.usedKm)).toEqual([0, 100, 100]);
  });

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
