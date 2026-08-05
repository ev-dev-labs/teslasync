import { describe, expect, it } from 'vitest';
import {
  normalizeHvacOn,
  summarizeHvacCycling,
  type HvacSignalSample,
} from './hvacCycling';

const BASE = Date.UTC(2026, 6, 1, 10, 0, 0);

function sample(minute: number, state: Partial<HvacSignalSample>): HvacSignalSample {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    ...state,
  };
}

describe('normalizeHvacOn', () => {
  it('treats any active compressor or fan signal as on', () => {
    expect(normalizeHvacOn({ hvacPower: 'Off', fanSpeed: 3 })).toBe(true);
    expect(normalizeHvacOn({ isAcOn: true, hvacFanStatus: 0 })).toBe(true);
    expect(normalizeHvacOn({ hvacPower: 'cooling' })).toBe(true);
  });

  it('recognises explicit off and preserves unknown state', () => {
    expect(normalizeHvacOn({ hvacPower: 'Off', isAcOn: false, fanSpeed: 0 })).toBe(false);
    expect(normalizeHvacOn({ hvacPower: 'mystery' })).toBeNull();
    expect(normalizeHvacOn({})).toBeNull();
  });
});

describe('summarizeHvacCycling', () => {
  it('run-length segments intervals and computes duration-weighted duty', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: 'On' }),
      sample(5, { hvacPower: 'On' }),
      sample(10, { hvacPower: 'Off' }),
      sample(20, { hvacPower: 'Off' }),
      sample(30, { isAcOn: true }),
      sample(35, { isAcOn: false }),
    ]);
    expect(result.runs.map((run) => [run.on, run.durationS])).toEqual([
      [true, 600],
      [false, 1200],
      [true, 300],
    ]);
    expect(result.dutyCycle).toBeCloseTo(3 / 7);
    expect(result.eventCount).toBe(2);
    expect(result.medianOnS).toBe(450);
    expect(result.medianOffS).toBe(1200);
    expect(result.longestRunS).toBe(600);
  });

  it('reports short-cycle share over on events only', () => {
    const result = summarizeHvacCycling(
      [
        sample(0, { hvacPower: 'On' }),
        sample(5, { hvacPower: 'Off' }),
        sample(10, { hvacPower: 'On' }),
        sample(30, { hvacPower: 'Off' }),
        sample(40, { hvacPower: 'Off' }),
      ],
      { shortCycleThresholdS: 600 },
    );
    expect(result.eventCount).toBe(2);
    expect(result.shortCycleRate).toBe(0.5);
  });

  it('does not bridge missing telemetry gaps', () => {
    const result = summarizeHvacCycling(
      [
        sample(0, { hvacPower: 'On' }),
        sample(5, { hvacPower: 'On' }),
        sample(100, { hvacPower: 'On' }),
        sample(105, { hvacPower: 'Off' }),
      ],
      { maxGapS: 600 },
    );
    expect(result.observedS).toBe(600);
    expect(result.runs).toHaveLength(2);
  });

  it('sorts samples, accepts created_at, and ignores unknown rows', () => {
    const result = summarizeHvacCycling([
      sample(10, { hvacPower: 'Off' }),
      { created_at: new Date(BASE).toISOString(), fanSpeed: 2 },
      sample(5, { hvacPower: 'unknown' }),
    ]);
    expect(result.analyzedSamples).toBe(2);
    expect(result.eventCount).toBe(1);
  });

  it('allocates observed time into the 24-hour profile', () => {
    const result = summarizeHvacCycling([
      sample(0, { hvacPower: 'On' }),
      sample(120, { hvacPower: 'Off' }),
    ], { maxGapS: 3 * 3600 });
    expect(result.hourlyProfile).toHaveLength(24);
    expect(result.hourlyProfile.reduce((sum, bucket) => sum + bucket.observedS, 0)).toBe(7200);
    expect(result.hourlyProfile.reduce((sum, bucket) => sum + bucket.onS, 0)).toBe(7200);
  });

  it('returns null metrics without observed intervals', () => {
    const result = summarizeHvacCycling([]);
    expect(result.dutyCycle).toBeNull();
    expect(result.medianOnS).toBeNull();
    expect(result.shortCycleRate).toBeNull();
    expect(result.hourlyProfile.every((bucket) => bucket.dutyCycle == null)).toBe(true);
  });
});
