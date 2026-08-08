import { describe, it, expect } from 'vitest';
import type { Drive } from '@/types/driving';
import {
  analyzeFirmwareImpact,
  normalizeInstalls,
  regularizedIncompleteBeta,
  twoSidedTP,
  welchTTest,
  type FirmwareInstall,
} from './firmwareImpact';

let nextId = 1;

const ANCHOR = Date.UTC(2026, 3, 1);

function driveAt(dayOffset: number, whPerKm: number, km = 50): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(ANCHOR + dayOffset * 86_400_000).toISOString(),
    endTs: null,
    durationS: 3600,
    distanceM: km * 1000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 90,
    endBatteryPct: 70,
    energyUsedWh: whPerKm * km,
    regenEnergyWh: null,
    avgSpeedMps: 20,
    maxSpeedMps: 35,
    avgPowerW: null,
    outsideTempAvgC: 12,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

function install(dayOffset: number, version: string): FirmwareInstall {
  return {
    version,
    installedAt: new Date(ANCHOR + dayOffset * 86_400_000).toISOString(),
    status: 'installed',
  };
}

/** Deterministic wobble so samples have non-zero variance. */
function wobble(i: number): number {
  return ((i * 37) % 11) - 5;
}

/** Wider deterministic spread, roughly uniform over ±10 (sd ≈ 5.8). */
function spread(i: number): number {
  return ((i * 7919) % 2003) / 100 - 10;
}

describe('regularizedIncompleteBeta', () => {
  it('matches known closed-form values', () => {
    // I_x(1,1) = x.
    expect(regularizedIncompleteBeta(1, 1, 0.25)).toBeCloseTo(0.25, 9);
    expect(regularizedIncompleteBeta(1, 1, 0.8)).toBeCloseTo(0.8, 9);
    // I_x(2,1) = x².
    expect(regularizedIncompleteBeta(2, 1, 0.5)).toBeCloseTo(0.25, 9);
    // Symmetry: I_x(a,b) = 1 − I_{1−x}(b,a).
    expect(regularizedIncompleteBeta(3, 5, 0.4)).toBeCloseTo(
      1 - regularizedIncompleteBeta(5, 3, 0.6),
      9,
    );
  });

  it('clamps outside the unit interval', () => {
    expect(regularizedIncompleteBeta(2, 3, 0)).toBe(0);
    expect(regularizedIncompleteBeta(2, 3, 1)).toBe(1);
  });
});

describe('twoSidedTP', () => {
  it('returns 1 for a zero statistic', () => {
    expect(twoSidedTP(0, 10)).toBeCloseTo(1, 9);
  });

  it('matches textbook critical values', () => {
    // t(0.975, df=10) = 2.228 → two-sided p ≈ 0.05.
    expect(twoSidedTP(2.228, 10)).toBeCloseTo(0.05, 3);
    // t(0.975, df=∞) → 1.96 → p ≈ 0.05.
    expect(twoSidedTP(1.96, 10_000)).toBeCloseTo(0.05, 3);
  });

  it('is symmetric in the sign of t', () => {
    expect(twoSidedTP(-1.7, 8)).toBeCloseTo(twoSidedTP(1.7, 8), 12);
  });

  it('degrades safely on nonsense input', () => {
    expect(twoSidedTP(Number.NaN, 10)).toBe(1);
    expect(twoSidedTP(2, 0)).toBe(1);
  });
});

describe('welchTTest', () => {
  it('finds no difference between identical samples', () => {
    const s = { n: 20, mean: 180, sd: 12 };
    const r = welchTTest(s, s)!;
    expect(r.t).toBeCloseTo(0, 9);
    expect(r.p).toBeCloseTo(1, 6);
  });

  it('detects a clean separation', () => {
    const r = welchTTest({ n: 30, mean: 180, sd: 8 }, { n: 30, mean: 200, sd: 8 })!;
    expect(r.t).toBeGreaterThan(5);
    expect(r.p).toBeLessThan(0.001);
  });

  it('handles unequal variance and sample size', () => {
    const r = welchTTest({ n: 6, mean: 180, sd: 30 }, { n: 60, mean: 186, sd: 5 })!;
    // Welch must NOT be fooled by the tiny, noisy first sample.
    expect(r.p).toBeGreaterThan(0.05);
    expect(r.df).toBeLessThan(60);
  });

  it('returns null below two observations', () => {
    expect(welchTTest({ n: 1, mean: 1, sd: 1 }, { n: 10, mean: 2, sd: 1 })).toBeNull();
  });
});

describe('normalizeInstalls', () => {
  it('drops non-installed, undated and unparseable entries', () => {
    const list = normalizeInstalls([
      install(10, '2026.8.1'),
      { version: '2026.9.1', installedAt: null, status: 'available' },
      { version: '2026.10.1', installedAt: 'nope', status: 'installed' },
      { version: '2026.11.1', installedAt: new Date(ANCHOR).toISOString(), status: 'downloading' },
    ]);
    expect(list.map((i) => i.version)).toEqual(['2026.8.1']);
  });

  it('keeps the earliest sighting of a repeated version and sorts ascending', () => {
    const list = normalizeInstalls([
      install(40, '2026.8.1'),
      install(10, '2026.8.1'),
      install(20, '2026.4.1'),
    ]);
    expect(list.map((i) => i.version)).toEqual(['2026.8.1', '2026.4.1']);
    expect(list[0]!.ms).toBeLessThan(list[1]!.ms);
  });

  it('accepts entries with no status field', () => {
    const list = normalizeInstalls([
      { version: '2026.12.1', installedAt: new Date(ANCHOR).toISOString() },
    ]);
    expect(list).toHaveLength(1);
  });
});

describe('analyzeFirmwareImpact', () => {
  it('is empty and safe with no data', () => {
    const s = analyzeFirmwareImpact([], []);
    expect(s.impacts).toEqual([]);
    expect(s.significantCount).toBe(0);
    expect(s.analyzedDrives).toBe(0);
  });

  it('flags a genuine regression as worse', () => {
    const drives = [
      ...Array.from({ length: 20 }, (_, i) => driveAt(-25 + i, 170 + wobble(i))),
      ...Array.from({ length: 20 }, (_, i) => driveAt(1 + i, 200 + wobble(i))),
    ];
    const [impact] = analyzeFirmwareImpact([install(0, '2026.20.1')], drives).impacts;
    expect(impact!.verdict).toBe('worse');
    expect(impact!.deltaWhPerKm).toBeGreaterThan(20);
    expect(impact!.p!).toBeLessThan(0.01);
    expect(impact!.cohensD!).toBeGreaterThan(1);
  });

  it('flags a genuine improvement as better', () => {
    const drives = [
      ...Array.from({ length: 20 }, (_, i) => driveAt(-25 + i, 210 + wobble(i))),
      ...Array.from({ length: 20 }, (_, i) => driveAt(1 + i, 180 + wobble(i))),
    ];
    const [impact] = analyzeFirmwareImpact([install(0, '2026.20.1')], drives).impacts;
    expect(impact!.verdict).toBe('better');
    expect(impact!.deltaShare).toBeLessThan(0);
  });

  it('calls noChange when nothing moved', () => {
    const drives = Array.from({ length: 44 }, (_, i) => driveAt(-25 + i, 185 + wobble(i)));
    const [impact] = analyzeFirmwareImpact([install(0, '2026.20.1')], drives).impacts;
    expect(impact!.verdict).toBe('noChange');
    expect(impact!.p!).toBeGreaterThan(0.05);
  });

  it('refuses a verdict on a statistically significant but trivial effect', () => {
    // 300 drives a side: a 2 Wh/km shift against ~5.8 Wh/km noise is highly
    // significant (p < 0.001) yet only d ≈ 0.35 — the effect-size gate must
    // stop it being reported as a regression.
    const drives = [
      ...Array.from({ length: 300 }, (_, i) => driveAt(-29 + i * 0.096, 180 + spread(i))),
      ...Array.from({ length: 300 }, (_, i) => driveAt(0.1 + i * 0.096, 182 + spread(i + 37))),
    ];
    const [impact] = analyzeFirmwareImpact([install(0, '2026.20.1')], drives, {
      minEffect: 1,
    }).impacts;
    expect(impact!.p!).toBeLessThan(0.01);
    expect(Math.abs(impact!.cohensD!)).toBeLessThan(1);
    expect(impact!.verdict).toBe('noChange');
  });

  it('marks a thin window as insufficient rather than guessing', () => {
    const drives = [driveAt(-3, 180), driveAt(2, 220)];
    const summary = analyzeFirmwareImpact([install(0, '2026.20.1')], drives);
    expect(summary.impacts[0]!.verdict).toBe('insufficient');
    expect(summary.impacts[0]!.p).toBeNull();
    expect(summary.skipped).toBe(1);
  });

  it('credits every post-install drive to exactly one version', () => {
    const drives = Array.from({ length: 60 }, (_, i) => driveAt(-30 + i, 180 + wobble(i)));
    const summary = analyzeFirmwareImpact(
      [install(0, '2026.20.1'), install(6, '2026.20.2')],
      drives,
      { minSample: 3 },
    );
    const first = summary.impacts.find((i) => i.version === '2026.20.1')!;
    const second = summary.impacts.find((i) => i.version === '2026.20.2')!;

    // Install 1 only owns days 0–5; day 6 onward belongs to install 2. The
    // 30 drives on or after day 0 are split with no drive counted twice.
    expect(first.after.n).toBe(6);
    expect(second.after.n).toBe(24);
    expect(first.after.n + second.after.n).toBe(30);

    // Install 2's baseline is clipped back to install 1 rather than reaching
    // 30 days into a version it never ran.
    expect(second.before.n).toBe(6);
    expect(first.before.n).toBe(30);
  });

  it('returns impacts newest-first', () => {
    const drives = Array.from({ length: 120 }, (_, i) => driveAt(-60 + i, 180 + wobble(i)));
    const summary = analyzeFirmwareImpact(
      [install(-40, 'a'), install(0, 'b'), install(40, 'c')],
      drives,
    );
    expect(summary.impacts.map((i) => i.version)).toEqual(['c', 'b', 'a']);
  });
});
