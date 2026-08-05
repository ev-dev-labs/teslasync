import { describe, it, expect } from 'vitest';
import {
  normalizeSamples,
  theilSenWithConfidence,
  daysToThreshold,
  summarizeTireDifferentialDrift,
  type TireDifferentialSample,
} from './tireDifferentialDrift';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);
const DAY = 86_400_000;
const BAR = 100_000; // Pa

/**
 * Synthetic fleet of TPMS samples: a shared common-mode signal (e.g. a
 * seasonal cool-down) applied to all four corners, plus optional per-corner
 * drift and constant offsets layered on top.
 */
function buildSamples(opts: {
  days: number;
  commonModePaPerDay?: number;
  startPa?: number;
  drift?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', number>>;
  offset?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', number>>;
  jitter?: number;
}): TireDifferentialSample[] {
  const {
    days,
    commonModePaPerDay = 0,
    startPa = 2.4 * BAR,
    drift = {},
    offset = {},
    jitter = 0,
  } = opts;
  const out: TireDifferentialSample[] = [];
  for (let d = 0; d < days; d++) {
    const common = startPa + commonModePaPerDay * d;
    // Deterministic small alternating jitter instead of Math.random() so
    // every test run is bit-for-bit reproducible.
    const j = jitter * (d % 2 === 0 ? 1 : -1);
    out.push({
      ts: new Date(BASE + d * DAY).toISOString(),
      front_left: common + (offset.fl ?? 0) + (drift.fl ?? 0) * d + j,
      front_right: common + (offset.fr ?? 0) + (drift.fr ?? 0) * d - j,
      rear_left: common + (offset.rl ?? 0) + (drift.rl ?? 0) * d + j,
      rear_right: common + (offset.rr ?? 0) + (drift.rr ?? 0) * d - j,
    });
  }
  return out;
}

describe('normalizeSamples', () => {
  it('reads snake_case and camelCase corner fields alike', () => {
    const rows = normalizeSamples([
      { ts: new Date(BASE).toISOString(), front_left: 2.4 * BAR, frontRight: 2.4 * BAR, rear_left: 2.4 * BAR, rearRight: 2.4 * BAR },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fr).toBeCloseTo(2.4 * BAR);
  });

  it('drops rows missing any one corner', () => {
    const rows = normalizeSamples([
      { ts: new Date(BASE).toISOString(), front_left: 2.4 * BAR, front_right: 2.4 * BAR, rear_left: 2.4 * BAR },
    ]);
    expect(rows).toHaveLength(0);
  });

  it('drops implausible readings (e.g. an unconverted raw codec value)', () => {
    const rows = normalizeSamples([
      { ts: new Date(BASE).toISOString(), front_left: 2.2, front_right: 2.3, rear_left: 2.0, rear_right: 2.1 },
    ]);
    expect(rows).toHaveLength(0);
  });

  it('sorts ascending and de-duplicates identical timestamps', () => {
    const rows = normalizeSamples([
      { ts: new Date(BASE + DAY).toISOString(), front_left: 2.5 * BAR, front_right: 2.5 * BAR, rear_left: 2.5 * BAR, rear_right: 2.5 * BAR },
      { ts: new Date(BASE).toISOString(), front_left: 2.4 * BAR, front_right: 2.4 * BAR, rear_left: 2.4 * BAR, rear_right: 2.4 * BAR },
      { ts: new Date(BASE).toISOString(), front_left: 2.45 * BAR, front_right: 2.45 * BAR, rear_left: 2.45 * BAR, rear_right: 2.45 * BAR },
    ]);
    expect(rows.map((r) => r.ms)).toEqual([BASE, BASE + DAY]);
    expect(rows[0]!.fl).toBeCloseTo(2.45 * BAR);
  });

  it('collapses carry-forward runs of identical four-corner values', () => {
    const first = {
      front_left: 2.4 * BAR,
      front_right: 2.4 * BAR,
      rear_left: 2.4 * BAR,
      rear_right: 2.4 * BAR,
    };
    const changed = {
      front_left: 2.35 * BAR,
      front_right: 2.4 * BAR,
      rear_left: 2.4 * BAR,
      rear_right: 2.4 * BAR,
    };
    const rows = normalizeSamples([
      { ts: new Date(BASE).toISOString(), ...first },
      { ts: new Date(BASE + 3_600_000).toISOString(), ...first },
      { ts: new Date(BASE + DAY).toISOString(), ...changed },
      { ts: new Date(BASE + DAY + 3_600_000).toISOString(), ...changed },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ms)).toEqual([BASE, BASE + DAY]);
  });
});

describe('theilSenWithConfidence', () => {
  it('recovers a perfectly linear slope with full confidence', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => 10 - 2 * x);
    const { slope, confidence } = theilSenWithConfidence(xs, ys, 200);
    expect(slope).toBeCloseTo(-2, 6);
    expect(confidence).toBeCloseTo(1, 6);
  });

  it('reports low confidence for sign-inconsistent pairs', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = [0, 5, -5, 5, -5, 5];
    const { confidence } = theilSenWithConfidence(xs, ys, 200);
    expect(confidence).toBeLessThan(0.8);
  });

  it('returns zero slope and zero confidence with under two points', () => {
    expect(theilSenWithConfidence([0], [1], 200)).toEqual({ slope: 0, confidence: 0 });
    expect(theilSenWithConfidence([], [], 200)).toEqual({ slope: 0, confidence: 0 });
  });
});

describe('daysToThreshold', () => {
  it('projects forward when the corner is diverging', () => {
    // Residual at -10,000 Pa, losing 1,000 Pa/day → threshold 30,000 Pa
    // reached in (30,000 - 10,000) / 1,000 = 20 days.
    expect(daysToThreshold(-10_000, -1_000, 30_000)).toBe(20);
  });

  it('returns 0 when already beyond threshold', () => {
    expect(daysToThreshold(-35_000, -500, 30_000)).toBe(0);
  });

  it('returns null when the trend is healing, not diverging', () => {
    expect(daysToThreshold(-10_000, 500, 30_000)).toBeNull();
  });

  it('returns null for a negligible slope', () => {
    expect(daysToThreshold(-1_000, 0, 30_000)).toBeNull();
  });

  it('returns null beyond the projection horizon', () => {
    expect(daysToThreshold(-100, -0.001, 30_000, 3650)).toBeNull();
  });
});

describe('summarizeTireDifferentialDrift', () => {
  it('is a no-op on too few samples', () => {
    const summary = summarizeTireDifferentialDrift([]);
    expect(summary.usableSamples).toBe(0);
    expect(summary.spanDays).toBeNull();
    expect(summary.leakCorner).toBeNull();
    expect(summary.corners).toHaveLength(4);
    expect(summary.corners.every((c) => c.daysToThreshold === null)).toBe(true);
  });

  it('cancels a shared common-mode trend across all four corners', () => {
    // All four corners fall together at 2,000 Pa/day (e.g. cooling
    // weather). With no independent drift, every corner's residual slope
    // should be ~0 and no leak should be flagged, even though every raw
    // reading is falling hard.
    const samples = buildSamples({ days: 20, commonModePaPerDay: -2_000, jitter: 50 });
    const summary = summarizeTireDifferentialDrift(samples);
    expect(summary.leakCorner).toBeNull();
    for (const c of summary.corners) {
      expect(Math.abs(c.slopePaPerDay)).toBeLessThan(50);
    }
  });

  it('identifies the corner with an independent slow leak', () => {
    const samples = buildSamples({
      days: 30,
      commonModePaPerDay: -300, // small shared weather drift
      drift: { rl: -2_500 }, // rear-left losing pressure on its own
      jitter: 20,
    });
    const summary = summarizeTireDifferentialDrift(samples);
    expect(summary.leakCorner).toBe('rl');
    const rl = summary.corners.find((c) => c.corner === 'rl')!;
    expect(rl.slopePaPerDay).toBeLessThan(-2_000);
    expect(rl.confidence).toBeGreaterThan(0.65);
    expect(rl.daysToThreshold).not.toBeNull();

    for (const c of summary.corners) {
      if (c.corner === 'rl') continue;
      expect(Math.abs(c.slopePaPerDay)).toBeLessThan(500);
    }
  });

  it('detects a constant structural imbalance with no drift', () => {
    const samples = buildSamples({
      days: 20,
      offset: { fr: 25_000 }, // front-right permanently ~0.25 bar higher
      jitter: 20,
    });
    const summary = summarizeTireDifferentialDrift(samples);
    expect(summary.leakCorner).toBeNull(); // no slope, so no leak
    expect(summary.imbalanceCorner).toBe('fr');
    expect(summary.imbalancePa).toBeGreaterThan(15_000);
  });

  it('produces one residual point per usable sample, summing near zero', () => {
    const samples = buildSamples({ days: 10, jitter: 30 });
    const summary = summarizeTireDifferentialDrift(samples);
    expect(summary.residuals).toHaveLength(10);
    for (const r of summary.residuals) {
      const sum = r.fl + r.fr + r.rl + r.rr;
      expect(Math.abs(sum)).toBeLessThan(1); // residuals are relative to the median, roughly cancel
    }
  });

  it('withholds the leak flag and projection below the evidence bar', () => {
    // Only 4 samples — below the default minSamples (8) — even with a
    // large, unambiguous drift on one corner.
    const samples = buildSamples({ days: 4, drift: { fl: -5_000 } });
    const summary = summarizeTireDifferentialDrift(samples);
    expect(summary.leakCorner).toBeNull();
    expect(summary.corners.every((c) => c.daysToThreshold === null)).toBe(true);
  });
});
