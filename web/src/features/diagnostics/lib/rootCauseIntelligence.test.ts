import { describe, expect, it } from 'vitest';
import {
  analyzeRootCause,
  buildNormalizedTimeline,
  classifySignalDomains,
  CONCURRENT_TOLERANCE_MS,
  findStrongestRobustShift,
  isAnalysisDefensible,
  mad,
  MAX_EFFECT_SIZE,
  MAX_RELATED_SIGNALS,
  median,
  MIN_CANDIDATE_EFFECT_SIZE,
  MIN_FOCAL_EFFECT_SIZE,
  NO_CAUSAL_PROOF_DISCLAIMER,
  robustSpread,
  selectRelatedSignals,
  toNumericPoints,
  type NumericPoint,
  type RankedHypothesis,
  type RawSignalPoint,
  type RootCauseAnalysisResult,
} from './rootCauseIntelligence';

const MIN = 60_000;
const BASE = Date.UTC(2024, 0, 1, 0, 0, 0);

/**
 * Deterministic pseudo-noise (sine-hash trick) — no `Math.random`, fully
 * reproducible across runs/machines, but behaves like genuine sample-to-
 * sample noise instead of a smooth, highly-autocorrelated sine wave.
 */
function jitter(i: number, amplitude: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const frac = x - Math.floor(x);
  return (frac - 0.5) * 2 * amplitude;
}

/** A perfectly noiseless two-level step series — every point on each side is exactly equal. */
function flatStep(params: {
  count: number;
  stepEveryMs?: number;
  before: number;
  after: number;
  shiftAtIndex: number;
  startMs?: number;
}): RawSignalPoint[] {
  const { count, stepEveryMs = MIN, before, after, shiftAtIndex, startMs = BASE } = params;
  const points: RawSignalPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ms = startMs + i * stepEveryMs;
    const value = i < shiftAtIndex ? before : after;
    points.push({ timestamp: new Date(ms).toISOString(), valueNum: value });
  }
  return points;
}

/** A two-level step series with small deterministic jitter added (MAD > 0 on both sides). */
function jitteredStep(params: {
  count: number;
  stepEveryMs?: number;
  before: number;
  after: number;
  shiftAtIndex: number;
  jitterAmplitude: number;
  startMs?: number;
}): RawSignalPoint[] {
  const { count, stepEveryMs = MIN, before, after, shiftAtIndex, jitterAmplitude, startMs = BASE } = params;
  const points: RawSignalPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ms = startMs + i * stepEveryMs;
    const base = i < shiftAtIndex ? before : after;
    points.push({ timestamp: new Date(ms).toISOString(), valueNum: base + jitter(i, jitterAmplitude) });
  }
  return points;
}

/** A perfectly flat (constant, zero-jitter) series — used as a deterministic "no shift" fixture. */
function flatConstant(params: { count: number; value: number; stepEveryMs?: number; startMs?: number }): RawSignalPoint[] {
  return flatStep({ ...params, before: params.value, after: params.value, shiftAtIndex: params.count });
}

function toPoints(raw: RawSignalPoint[]): NumericPoint[] {
  return toNumericPoints(raw);
}

// ─────────────────────────────────────────────────────────────────────────
// classifySignalDomains
// ─────────────────────────────────────────────────────────────────────────

describe('classifySignalDomains', () => {
  it('classifies domain-pure signal names', () => {
    expect(classifySignalDomains('WifiSignalStrength')).toEqual(['connectivity']);
    expect(classifySignalDomains('TirePressureFrontLeft')).toEqual(['tire']);
    expect(classifySignalDomains('VehicleSpeed')).toEqual(['motion']);
    expect(classifySignalDomains('CoolantTemp')).toEqual(['thermal']);
    expect(classifySignalDomains('MotorRPM')).toEqual(['drivetrain']);
    expect(classifySignalDomains('ChargeRateKw')).toEqual(['charge']);
  });

  it('classifies multi-domain signal names (domains are not mutually exclusive)', () => {
    const domains = classifySignalDomains('PackTemperature');
    expect(domains).toContain('thermal');
  });

  it('returns an empty array when nothing matches', () => {
    expect(classifySignalDomains('UserProfileDisplayName')).toEqual([]);
  });

  it('is deterministic and order-stable across repeated calls', () => {
    const a = classifySignalDomains('BatteryPackTemperatureAvg');
    const b = classifySignalDomains('BatteryPackTemperatureAvg');
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// toNumericPoints — defensive parsing, aliases, malformed data
// ─────────────────────────────────────────────────────────────────────────

describe('toNumericPoints', () => {
  it('returns an empty array for empty/null/undefined input', () => {
    expect(toNumericPoints([])).toEqual([]);
    expect(toNumericPoints(null)).toEqual([]);
    expect(toNumericPoints(undefined)).toEqual([]);
  });

  it('drops malformed/non-numeric/null entries without throwing', () => {
    const points = toNumericPoints([
      null as unknown as RawSignalPoint,
      undefined as unknown as RawSignalPoint,
      { timestamp: 'not-a-date', valueNum: 5 },
      { timestamp: new Date(BASE).toISOString(), valueNum: Number.NaN },
      { timestamp: new Date(BASE).toISOString(), valueNum: 'not-a-number' },
      { timestamp: new Date(BASE).toISOString() },
      {},
      { timestamp: new Date(BASE + MIN).toISOString(), valueNum: 42 },
    ]);
    expect(points).toEqual([{ ms: BASE + MIN, value: 42 }]);
  });

  it('accepts the `ts` timestamp alias when `timestamp` is absent', () => {
    const points = toNumericPoints([{ ts: new Date(BASE).toISOString(), valueNum: 7 }]);
    expect(points).toEqual([{ ms: BASE, value: 7 }]);
  });

  it('prefers `timestamp` over `ts` when both are present', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE + MIN).toISOString(), ts: new Date(BASE).toISOString(), valueNum: 1 },
    ]);
    expect(points).toEqual([{ ms: BASE + MIN, value: 1 }]);
  });

  it('accepts numeric epoch-ms timestamps directly', () => {
    const points = toNumericPoints([{ timestamp: BASE, valueNum: 3 }]);
    expect(points).toEqual([{ ms: BASE, value: 3 }]);
  });

  it('accepts the `value_num` alias when `valueNum` is absent', () => {
    const points = toNumericPoints([{ timestamp: new Date(BASE).toISOString(), value_num: 9 }]);
    expect(points).toEqual([{ ms: BASE, value: 9 }]);
  });

  it('accepts the `value` alias when neither `valueNum` nor `value_num` is present', () => {
    const points = toNumericPoints([{ timestamp: new Date(BASE).toISOString(), value: 11 }]);
    expect(points).toEqual([{ ms: BASE, value: 11 }]);
  });

  it('prefers valueNum > value_num > value when several are present', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE).toISOString(), valueNum: 1, value_num: 2, value: 3 },
    ]);
    expect(points[0]!.value).toBe(1);
    const points2 = toNumericPoints([{ timestamp: new Date(BASE).toISOString(), value_num: 2, value: 3 }]);
    expect(points2[0]!.value).toBe(2);
  });

  it('accepts stringified numeric values', () => {
    const points = toNumericPoints([{ timestamp: new Date(BASE).toISOString(), valueNum: '42.5' }]);
    expect(points).toEqual([{ ms: BASE, value: 42.5 }]);
  });

  it('sorts output ascending by timestamp regardless of input order', () => {
    const points = toNumericPoints([
      { timestamp: new Date(BASE + 2 * MIN).toISOString(), valueNum: 3 },
      { timestamp: new Date(BASE).toISOString(), valueNum: 1 },
      { timestamp: new Date(BASE + MIN).toISOString(), valueNum: 2 },
    ]);
    expect(points.map((p) => p.value)).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// selectRelatedSignals — deterministic domain-aware scoring
// ─────────────────────────────────────────────────────────────────────────

describe('selectRelatedSignals', () => {
  const catalog = [
    'PackVoltage',
    'CellVoltageMin',
    'BatteryLevel',
    'PackTemperature',
    'TirePressureFrontLeft',
    'CabinFanSpeed',
    'PackVoltage', // duplicate — must be de-duplicated
  ];

  it('returns an empty array for an empty focal signal', () => {
    expect(selectRelatedSignals('', catalog)).toEqual([]);
    expect(selectRelatedSignals('   ', catalog)).toEqual([]);
  });

  it('returns an empty array for an empty catalog', () => {
    expect(selectRelatedSignals('PackVoltage', [])).toEqual([]);
  });

  it('excludes the focal signal itself and de-duplicates the catalog', () => {
    const result = selectRelatedSignals('PackVoltage', catalog);
    expect(result.some((c) => c.signal === 'PackVoltage')).toBe(false);
    const signals = result.map((c) => c.signal);
    expect(new Set(signals).size).toBe(signals.length);
  });

  it('excludes unrelated signals (zero score)', () => {
    const result = selectRelatedSignals('PackVoltage', catalog);
    expect(result.some((c) => c.signal === 'TirePressureFrontLeft')).toBe(false);
    expect(result.some((c) => c.signal === 'CabinFanSpeed')).toBe(false);
  });

  it('includes domain/token-related signals', () => {
    const result = selectRelatedSignals('PackVoltage', catalog);
    const signals = result.map((c) => c.signal);
    expect(signals).toContain('CellVoltageMin');
    expect(signals).toContain('BatteryLevel');
    expect(signals).toContain('PackTemperature');
  });

  it('is sorted by score descending, then signal name ascending as a tie-break', () => {
    const result = selectRelatedSignals('PackVoltage', catalog);
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1]!;
      const curr = result[i]!;
      expect(
        prev.score > curr.score || (prev.score === curr.score && prev.signal.localeCompare(curr.signal) <= 0),
      ).toBe(true);
    }
  });

  it('is deterministic — repeated calls with the same input yield an identical result', () => {
    const a = selectRelatedSignals('PackVoltage', catalog);
    const b = selectRelatedSignals('PackVoltage', catalog);
    expect(a).toEqual(b);
  });

  it('caps the result at MAX_RELATED_SIGNALS', () => {
    const bigCatalog = Array.from({ length: 20 }, (_, i) => `BatteryCellVoltage${i}`);
    const result = selectRelatedSignals('BatteryPackVoltageAvg', bigCatalog);
    expect(result.length).toBeLessThanOrEqual(MAX_RELATED_SIGNALS);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// median / mad / robustSpread
// ─────────────────────────────────────────────────────────────────────────

describe('median / mad / robustSpread', () => {
  it('median returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });

  it('median handles odd- and even-length arrays', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('mad of a constant array is 0', () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });

  it('mad is robust to a single outlier', () => {
    expect(mad([5, 5, 5, 5, 5, 5, 5, 1000])).toBe(0);
  });

  it('robustSpread scales mad by the Gaussian consistency constant', () => {
    const values = [1, 2, 3, 4, 5, 100];
    expect(robustSpread(values)).toBeCloseTo(mad(values) * 1.4826, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// findStrongestRobustShift
// ─────────────────────────────────────────────────────────────────────────

describe('findStrongestRobustShift', () => {
  it('returns null for a too-short series', () => {
    const points = toPoints(flatConstant({ count: 4, value: 10 }));
    expect(findStrongestRobustShift(points)).toBeNull();
  });

  it('returns effectSize 0 / direction "flat" for a perfectly constant series', () => {
    const points = toPoints(flatConstant({ count: 40, value: 10 }));
    const shift = findStrongestRobustShift(points);
    expect(shift).not.toBeNull();
    expect(shift!.effectSize).toBe(0);
    expect(shift!.direction).toBe('flat');
  });

  it('detects a clean step shift at approximately the correct split and direction (up)', () => {
    const points = toPoints(
      jitteredStep({ count: 60, before: 0, after: 10, shiftAtIndex: 30, jitterAmplitude: 0.2 }),
    );
    const shift = findStrongestRobustShift(points);
    expect(shift).not.toBeNull();
    expect(shift!.direction).toBe('up');
    // The effect-size-maximizing split is an estimator, not an exact
    // recovery of the injected boundary — with finite noisy samples the
    // sample MAD on each side fluctuates a little near the true edge, so a
    // few minutes of slop is expected and acceptable here. The tolerance is
    // still tight relative to the 60-sample/59-minute span being searched.
    expect(Math.abs(shift!.splitMs - (BASE + 30 * MIN))).toBeLessThanOrEqual(6 * MIN);
  });

  it('detects a clean step shift downward', () => {
    const points = toPoints(
      jitteredStep({ count: 60, before: 380, after: 350, shiftAtIndex: 30, jitterAmplitude: 0.4 }),
    );
    const shift = findStrongestRobustShift(points);
    expect(shift).not.toBeNull();
    expect(shift!.direction).toBe('down');
  });

  it('clamps a noiseless (MAD=0) two-level step to MAX_EFFECT_SIZE instead of NaN/Infinity', () => {
    const points = toPoints(flatStep({ count: 40, before: 5, after: 9, shiftAtIndex: 20 }));
    const shift = findStrongestRobustShift(points);
    expect(shift).not.toBeNull();
    expect(Number.isFinite(shift!.effectSize)).toBe(true);
    expect(shift!.effectSize).toBe(MAX_EFFECT_SIZE);
    expect(shift!.direction).toBe('up');
  });

  it('is not fooled by a single outlier in an otherwise constant series (median/MAD robustness)', () => {
    const raw = flatConstant({ count: 40, value: 100 });
    // Inject one extreme spike in the middle — median-based detection must
    // not report a strong "shift" driven by a single anomalous sample.
    raw[20] = { timestamp: raw[20]!.timestamp, valueNum: 100_000 };
    const points = toPoints(raw);
    const shift = findStrongestRobustShift(points);
    expect(shift).not.toBeNull();
    expect(shift!.effectSize).toBeLessThan(MIN_CANDIDATE_EFFECT_SIZE);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildNormalizedTimeline
// ─────────────────────────────────────────────────────────────────────────

describe('buildNormalizedTimeline', () => {
  it('returns an empty timeline for an empty focal signal or no focal points', () => {
    expect(buildNormalizedTimeline('', [], [])).toEqual({ timeline: [], seriesNames: [] });
    expect(buildNormalizedTimeline('Signal', [], [])).toEqual({ timeline: [], seriesNames: [] });
  });

  it('returns an empty timeline when the focal series has zero span', () => {
    const points = toPoints(flatConstant({ count: 1, value: 5 }));
    expect(buildNormalizedTimeline('Signal', points, [])).toEqual({ timeline: [], seriesNames: ['Signal'] });
  });

  it('builds a normalized grid with values in [0,1] or null, including all non-empty series', () => {
    const focal = toPoints(jitteredStep({ count: 60, before: 0, after: 10, shiftAtIndex: 30, jitterAmplitude: 0.1 }));
    const related = toPoints(jitteredStep({ count: 60, before: 30, after: 45, shiftAtIndex: 35, jitterAmplitude: 0.1 }));
    const emptyRelated: NumericPoint[] = [];
    const { timeline, seriesNames } = buildNormalizedTimeline('Focal', focal, [
      ['Related', related],
      ['EmptySeries', emptyRelated],
    ]);
    expect(seriesNames).toEqual(['Focal', 'Related']);
    expect(timeline.length).toBeGreaterThan(0);
    for (const row of timeline) {
      expect(typeof row.ms).toBe('number');
      expect(typeof row.time).toBe('string');
      for (const name of seriesNames) {
        const v = row[name];
        if (v != null) {
          expect(typeof v).toBe('number');
          expect(v as number).toBeGreaterThanOrEqual(0);
          expect(v as number).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('caps the number of grid rows at MAX_TIMELINE_POINTS', () => {
    const focal = toPoints(jitteredStep({ count: 2000, before: 0, after: 10, shiftAtIndex: 1000, jitterAmplitude: 0.1 }));
    const { timeline } = buildNormalizedTimeline('Focal', focal, []);
    expect(timeline.length).toBeLessThanOrEqual(240);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — empty / malformed input
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — empty/malformed input', () => {
  it('never throws and returns a fully-formed result for entirely empty input', () => {
    const result = analyzeRootCause({ focalSignal: '', catalog: [], focalPoints: [], relatedSeries: [] });
    expect(result.focalSignal).toBe('');
    expect(result.hypotheses).toEqual([]);
    expect(result.graph).toEqual({ nodes: [], edges: [] });
    expect(result.timeline).toEqual([]);
    expect(result.focalShift).toBeNull();
    expect(result.quality.band).toBe('insufficient');
  });

  it('never throws for malformed/garbage input', () => {
    const result = analyzeRootCause({
      focalSignal: '  PackVoltage  ',
      catalog: [null as unknown as string, undefined as unknown as string, '', 'PackVoltage', 'CellVoltageMin'],
      focalPoints: [
        null as unknown as RawSignalPoint,
        { timestamp: 'garbage', valueNum: 'nope' },
        {},
      ],
      relatedSeries: [
        null as unknown as { signal: string; points: RawSignalPoint[] },
        { signal: 'CellVoltageMin', points: [{ timestamp: 'also garbage', valueNum: NaN }] },
      ],
    });
    expect(result.focalSignal).toBe('PackVoltage');
    expect(result.hypotheses).toEqual([]);
    expect(result.focalShift).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — weak/short evidence withholding
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — withholds weak/short evidence', () => {
  it('withholds all hypotheses when the focal series is too short', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage', 'CellVoltageMin'],
      focalPoints: flatStep({ count: 6, before: 380, after: 350, shiftAtIndex: 3 }),
      relatedSeries: [],
    });
    expect(result.focalShift).toBeNull();
    expect(result.hypotheses).toEqual([]);
    expect(result.quality.band).toBe('insufficient');
  });

  it('withholds all hypotheses when the analyzed window is too short in duration', () => {
    // Many samples, but packed into a window well under MIN_WINDOW_MS.
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage'],
      focalPoints: flatStep({ count: 40, stepEveryMs: 1000, before: 380, after: 350, shiftAtIndex: 20 }),
      relatedSeries: [],
    });
    expect(result.focalShift).toBeNull();
    expect(result.hypotheses).toEqual([]);
  });

  it('withholds all hypotheses when the focal shift is too weak (effect size below minimum)', () => {
    // Large noise relative to a tiny level change — should not clear MIN_FOCAL_EFFECT_SIZE.
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage'],
      focalPoints: jitteredStep({ count: 60, before: 100, after: 100.1, shiftAtIndex: 30, jitterAmplitude: 5 }),
      relatedSeries: [],
    });
    expect(result.hypotheses).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — isolated focal shift (no corroborating candidates)
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — isolated focal shift', () => {
  it('reports a focal shift with zero hypotheses when related signals show no comparable shift', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage', 'BatteryLevel'],
      focalPoints: jitteredStep({ count: 90, before: 380, after: 350, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
      relatedSeries: [{ signal: 'BatteryLevel', points: flatConstant({ count: 90, value: 62 }) }],
    });
    expect(result.focalShift).not.toBeNull();
    expect(result.hypotheses).toEqual([]);
    expect(result.graph.nodes.some((n) => n.id === 'BatteryLevel' && n.hasEvidence === false)).toBe(true);
    expect(result.graph.edges).toEqual([]);
    expect(result.summary).not.toContain('undefined');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — leading / lagging / concurrent candidates
// ─────────────────────────────────────────────────────────────────────────

function buildLeadLagFixture(): RootCauseAnalysisResult {
  const catalog = ['PackVoltage', 'CellVoltageMin', 'BatteryLevel', 'PackTemperature', 'TirePressureFrontLeft', 'CabinFanSpeed'];
  return analyzeRootCause({
    focalSignal: 'PackVoltage',
    catalog,
    // Focal shifts at index 45 (t=45min): 380 -> 350 (down).
    focalPoints: jitteredStep({ count: 90, before: 380, after: 350, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
    relatedSeries: [
      // Leads by 10 minutes (shift at index 35).
      { signal: 'PackTemperature', points: jitteredStep({ count: 90, before: 30, after: 45, shiftAtIndex: 35, jitterAmplitude: 0.3 }) },
      // Lags by 10 minutes (shift at index 55).
      { signal: 'CellVoltageMin', points: jitteredStep({ count: 90, before: 3.7, after: 3.4, shiftAtIndex: 55, jitterAmplitude: 0.02 }) },
      // Related by domain, but never shifts — must NOT produce a hypothesis.
      { signal: 'BatteryLevel', points: flatConstant({ count: 90, value: 62 }) },
    ],
  });
}

describe('analyzeRootCause — leading candidate', () => {
  it('classifies a signal that shifted before the focal signal as "leads" with negative lagMs', () => {
    const result = buildLeadLagFixture();
    const leading = result.hypotheses.find((h) => h.signal === 'PackTemperature');
    expect(leading).toBeDefined();
    expect(leading!.relation).toBe('leads');
    expect(leading!.lagMs).toBeLessThan(0);
    // Estimated split points carry a few minutes of estimation slop (see
    // note above); the tolerance stays well below the 10-minute injected
    // separation so this still meaningfully validates lead detection.
    expect(Math.abs(Math.abs(leading!.lagMs) - 10 * MIN)).toBeLessThanOrEqual(6 * MIN);
  });
});

describe('analyzeRootCause — lagging candidate', () => {
  it('classifies a signal that shifted after the focal signal as "lags" with positive lagMs', () => {
    const result = buildLeadLagFixture();
    const lagging = result.hypotheses.find((h) => h.signal === 'CellVoltageMin');
    expect(lagging).toBeDefined();
    expect(lagging!.relation).toBe('lags');
    expect(lagging!.lagMs).toBeGreaterThan(0);
    expect(Math.abs(lagging!.lagMs - 10 * MIN)).toBeLessThanOrEqual(6 * MIN);
  });

  it('excludes a related-by-domain candidate that never shifts', () => {
    const result = buildLeadLagFixture();
    expect(result.hypotheses.some((h) => h.signal === 'BatteryLevel')).toBe(false);
    const node = result.graph.nodes.find((n) => n.id === 'BatteryLevel');
    expect(node?.hasEvidence).toBe(false);
  });
});

describe('analyzeRootCause — concurrent candidate', () => {
  it('classifies a signal shifting within the concurrent tolerance as "concurrent"', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage', 'CellVoltageMin'],
      focalPoints: jitteredStep({ count: 90, before: 380, after: 350, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
      relatedSeries: [
        // Shifts at exactly the same index — lag should be well within CONCURRENT_TOLERANCE_MS.
        { signal: 'CellVoltageMin', points: jitteredStep({ count: 90, before: 3.7, after: 3.4, shiftAtIndex: 45, jitterAmplitude: 0.02 }) },
      ],
    });
    const hyp = result.hypotheses.find((h) => h.signal === 'CellVoltageMin');
    expect(hyp).toBeDefined();
    expect(Math.abs(hyp!.lagMs)).toBeLessThanOrEqual(CONCURRENT_TOLERANCE_MS);
    expect(hyp!.relation).toBe('concurrent');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — ranking / ordering
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — ranking order', () => {
  it('sorts hypotheses by score descending, then signal name ascending', () => {
    const result = buildLeadLagFixture();
    expect(result.hypotheses.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.hypotheses.length; i += 1) {
      const prev = result.hypotheses[i - 1]!;
      const curr = result.hypotheses[i]!;
      expect(
        prev.score > curr.score || (prev.score === curr.score && prev.signal.localeCompare(curr.signal) <= 0),
      ).toBe(true);
    }
  });

  it('is deterministic across repeated calls with identical input', () => {
    const a = buildLeadLagFixture();
    const b = buildLeadLagFixture();
    expect(a.hypotheses.map((h) => h.signal)).toEqual(b.hypotheses.map((h) => h.signal));
    expect(a.hypotheses.map((h) => h.score)).toEqual(b.hypotheses.map((h) => h.score));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — quality / confidence bounds
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — quality/confidence bounds', () => {
  function assertHypothesisBounds(h: RankedHypothesis): void {
    for (const field of [h.effectScore, h.temporalScore, h.coverageScore, h.reliabilityScore, h.score] as const) {
      expect(field).toBeGreaterThanOrEqual(0);
      expect(field).toBeLessThanOrEqual(1);
      expect(Number.isFinite(field)).toBe(true);
    }
  }

  it('keeps every sub-score and the overall score within [0,1] for a normal fixture', () => {
    const result = buildLeadLagFixture();
    for (const h of result.hypotheses) assertHypothesisBounds(h);
    expect(result.quality.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.quality.overallScore).toBeLessThanOrEqual(1);
  });

  it('keeps scores bounded even under extreme sample counts and effect sizes', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage', 'CellVoltageMin'],
      focalPoints: flatStep({ count: 5000, before: 0, after: 1_000_000, shiftAtIndex: 2500 }),
      relatedSeries: [
        { signal: 'CellVoltageMin', points: flatStep({ count: 5000, before: 0, after: 1_000_000, shiftAtIndex: 2500 }) },
      ],
    });
    for (const h of result.hypotheses) assertHypothesisBounds(h);
    expect(result.quality.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.quality.overallScore).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// analyzeRootCause — evidence graph shape
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRootCause — evidence graph', () => {
  it('includes a focal node plus one node per related candidate, and edges only for evidenced candidates', () => {
    const result = buildLeadLagFixture();
    const focalNode = result.graph.nodes.find((n) => n.kind === 'focal');
    expect(focalNode?.id).toBe('PackVoltage');
    expect(focalNode?.hasEvidence).toBe(true);

    const candidateIds = result.graph.nodes.filter((n) => n.kind === 'candidate').map((n) => n.id);
    expect(candidateIds).toContain('PackTemperature');
    expect(candidateIds).toContain('CellVoltageMin');
    expect(candidateIds).toContain('BatteryLevel');

    expect(result.graph.edges.every((e) => e.source === 'PackVoltage')).toBe(true);
    const edgeTargets = result.graph.edges.map((e) => e.target);
    expect(edgeTargets).toContain('PackTemperature');
    expect(edgeTargets).toContain('CellVoltageMin');
    expect(edgeTargets).not.toContain('BatteryLevel');
  });

  it('returns an empty graph when no focal signal is selected', () => {
    const result = analyzeRootCause({ focalSignal: '', catalog: ['A', 'B'], focalPoints: [], relatedSeries: [] });
    expect(result.graph).toEqual({ nodes: [], edges: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isAnalysisDefensible
// ─────────────────────────────────────────────────────────────────────────

describe('isAnalysisDefensible', () => {
  it('is false when there is no focal shift', () => {
    const result = analyzeRootCause({ focalSignal: '', catalog: [], focalPoints: [], relatedSeries: [] });
    expect(isAnalysisDefensible(result)).toBe(false);
  });

  it('is true once a robust focal shift with non-insufficient quality is found', () => {
    const result = buildLeadLagFixture();
    expect(result.focalShift).not.toBeNull();
    expect(result.quality.band).not.toBe('insufficient');
    expect(isAnalysisDefensible(result)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// No causal overclaim strings
// ─────────────────────────────────────────────────────────────────────────

describe('no causal overclaim strings', () => {
  // Patterns that would constitute an affirmative causal/diagnostic claim.
  // Hedged disclaimers such as "not a diagnosis" or "not ... causal proof"
  // are expected and must NOT trip these — they are the opposite of an
  // overclaim. This intentionally targets affirmative phrasing, not the
  // bare words "cause"/"diagnosis"/"proof" (which legitimately appear
  // inside negated disclaimers throughout this module).
  const OVERCLAIM_PATTERNS: RegExp[] = [
    /\bis the cause\b/i,
    /\bis caused by\b/i,
    /\bcauses? the\b/i,
    /\bdiagnos(?:is|ed|es)\s+(?:is|as|confirms)\b/i,
    /\bconfirmed\s+(?:diagnosis|cause)\b/i,
    /\bproven?\s+to\b/i,
    /\bproves?\s+that\b/i,
    /\bthe root cause\b/i,
    /\bdefinitely\b/i,
    /\bcertainly\s+caused\b/i,
    /\bwas caused\b/i,
  ];

  function collectAllText(result: RootCauseAnalysisResult): string[] {
    return [result.summary, ...result.limitations, ...result.hypotheses.map((h) => h.rationale)];
  }

  function assertNoOverclaim(texts: readonly string[]): void {
    for (const text of texts) {
      for (const pattern of OVERCLAIM_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    }
  }

  it('never overclaims across the empty-input fixture', () => {
    const result = analyzeRootCause({ focalSignal: '', catalog: [], focalPoints: [], relatedSeries: [] });
    assertNoOverclaim(collectAllText(result));
  });

  it('never overclaims when no robust shift is found', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage'],
      focalPoints: flatConstant({ count: 40, value: 380 }),
      relatedSeries: [],
    });
    assertNoOverclaim(collectAllText(result));
  });

  it('never overclaims for an isolated focal shift', () => {
    const result = analyzeRootCause({
      focalSignal: 'PackVoltage',
      catalog: ['PackVoltage', 'BatteryLevel'],
      focalPoints: jitteredStep({ count: 90, before: 380, after: 350, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
      relatedSeries: [{ signal: 'BatteryLevel', points: flatConstant({ count: 90, value: 62 }) }],
    });
    assertNoOverclaim(collectAllText(result));
  });

  it('never overclaims for a fully corroborated multi-hypothesis fixture', () => {
    const result = buildLeadLagFixture();
    expect(result.hypotheses.length).toBeGreaterThan(0);
    assertNoOverclaim(collectAllText(result));
  });

  it('the canonical disclaimer itself does not match the overclaim patterns', () => {
    assertNoOverclaim([NO_CAUSAL_PROOF_DISCLAIMER]);
    expect(NO_CAUSAL_PROOF_DISCLAIMER).toContain('not a diagnosis');
  });
});

// Sanity check on the exported minimum-effect-size constants used above, so
// this suite fails loudly (rather than silently passing for the wrong
// reason) if the module's tuning constants ever drift.
describe('exported threshold constants', () => {
  it('are sane, positive, and ordered as expected', () => {
    expect(MIN_FOCAL_EFFECT_SIZE).toBeGreaterThan(0);
    expect(MIN_CANDIDATE_EFFECT_SIZE).toBeGreaterThan(0);
    expect(MIN_CANDIDATE_EFFECT_SIZE).toBeLessThanOrEqual(MIN_FOCAL_EFFECT_SIZE);
    expect(MAX_EFFECT_SIZE).toBeGreaterThan(MIN_FOCAL_EFFECT_SIZE);
  });
});
