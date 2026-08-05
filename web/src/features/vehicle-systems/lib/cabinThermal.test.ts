import { describe, it, expect } from 'vitest';
import {
  buildSoakCurve,
  fitSoakEvents,
  minutesToReach,
  predictCabinTemp,
  summarizeCabinThermal,
  type CabinSample,
} from './cabinThermal';

const BASE = Date.UTC(2026, 5, 1, 12, 0, 0);

/**
 * A synthetic soak: cabin relaxing from `startC` toward `ambientC` with a
 * known time constant, sampled every `stepMin`.
 */
function soak(opts: {
  startMinOffset: number;
  startC: number;
  ambientC: number;
  tauMin: number;
  points: number;
  stepMin?: number;
  hvacOn?: boolean;
}): CabinSample[] {
  const { startMinOffset, startC, ambientC, tauMin, points, stepMin = 10, hvacOn = false } = opts;
  return Array.from({ length: points }, (_, i) => {
    const t = i * stepMin;
    return {
      timestamp: new Date(BASE + (startMinOffset + t) * 60_000).toISOString(),
      insideTemp: ambientC + (startC - ambientC) * Math.exp(-t / tauMin),
      outsideTemp: ambientC,
      isAcOn: hvacOn,
      hvacPower: hvacOn,
    };
  });
}

describe('fitSoakEvents', () => {
  it('recovers a known time constant', () => {
    const { events } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.tauMin).toBeGreaterThan(85);
    expect(events[0]!.tauMin).toBeLessThan(95);
    expect(events[0]!.r2).toBeGreaterThan(0.99);
    expect(events[0]!.cooling).toBe(true);
  });

  it('recognises a warming cabin as its own regime', () => {
    const { events } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: -5, ambientC: 15, tauMin: 60, points: 12 }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.cooling).toBe(false);
    expect(events[0]!.tauMin).toBeGreaterThan(55);
  });

  it('never fits a window where the HVAC was running', () => {
    const { events, rejected } = fitSoakEvents(
      soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12, hvacOn: true }),
    );
    expect(events).toHaveLength(0);
    expect(rejected).toBe(0);
  });

  it('treats canonical hvacPower=true as running without an AC signal', () => {
    const samples = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 })
      .map((s) => ({ ...s, isAcOn: false, hvacPower: true }));
    expect(fitSoakEvents(samples).events).toHaveLength(0);
  });

  it('splits windows across an HVAC-on interruption', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 8 }),
      ...soak({ startMinOffset: 80, startC: 34, ambientC: 20, tauMin: 90, points: 3, hvacOn: true }),
      ...soak({ startMinOffset: 200, startC: 34, ambientC: 20, tauMin: 70, points: 8 }),
    ];
    const { events } = fitSoakEvents(samples);
    expect(events).toHaveLength(2);
    expect(events[0]!.tauMin).not.toBe(events[1]!.tauMin);
  });

  it('splits windows across a long sampling gap', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 8 }),
      ...soak({ startMinOffset: 500, startC: 38, ambientC: 20, tauMin: 90, points: 8 }),
    ];
    expect(fitSoakEvents(samples).events).toHaveLength(2);
  });

  it('rejects windows that are too short or too flat', () => {
    const short = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 4, stepMin: 2 });
    const flat = soak({ startMinOffset: 0, startC: 21, ambientC: 20, tauMin: 90, points: 12 });
    expect(fitSoakEvents(short).events).toHaveLength(0);
    expect(fitSoakEvents(flat).events).toHaveLength(0);
  });

  it('rejects a cabin heating away from ambient (solar gain)', () => {
    const climbing: CabinSample[] = Array.from({ length: 12 }, (_, i) => ({
      timestamp: new Date(BASE + i * 10 * 60_000).toISOString(),
      insideTemp: 25 + i * 1.5,
      outsideTemp: 20,
      isAcOn: false,
      hvacPower: false,
    }));
    const { events, rejected } = fitSoakEvents(climbing);
    expect(events).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it('ignores rows with missing temperatures or timestamps', () => {
    const junk: CabinSample[] = [
      { timestamp: null, insideTemp: 30, outsideTemp: 20 },
      { timestamp: 'nope', insideTemp: 30, outsideTemp: 20 },
      { timestamp: new Date(BASE).toISOString(), insideTemp: null, outsideTemp: 20 },
      { created_at: new Date(BASE).toISOString(), insideTemp: 30, outsideTemp: null },
    ];
    const { analyzed, events } = fitSoakEvents(junk);
    expect(analyzed).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('accepts created_at as the timestamp field', () => {
    const samples = soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 90, points: 12 })
      .map(({ timestamp, ...rest }) => ({ ...rest, created_at: timestamp }));
    expect(fitSoakEvents(samples).events).toHaveLength(1);
  });
});

describe('summarizeCabinThermal', () => {
  it('is fully null-safe with no data', () => {
    const s = summarizeCabinThermal([]);
    expect(s.tauMin).toBeNull();
    expect(s.halfLifeMin).toBeNull();
    expect(s.meanR2).toBeNull();
    expect(s.events).toEqual([]);
  });

  it('medians the fitted constants and separates the two regimes', () => {
    const samples: CabinSample[] = [
      ...soak({ startMinOffset: 0, startC: 40, ambientC: 20, tauMin: 60, points: 10 }),
      ...soak({ startMinOffset: 400, startC: 42, ambientC: 20, tauMin: 100, points: 10 }),
      ...soak({ startMinOffset: 800, startC: -5, ambientC: 15, tauMin: 40, points: 10 }),
    ];
    const s = summarizeCabinThermal(samples);
    expect(s.events).toHaveLength(3);
    expect(s.coolingTauMin).toBe(80);
    expect(s.warmingTauMin).toBeGreaterThan(35);
    expect(s.warmingTauMin).toBeLessThan(45);
    expect(s.halfLifeMin).toBe(Math.round(s.tauMin! * Math.LN2));
  });
});

describe('predictCabinTemp', () => {
  it('decays toward ambient by one time constant', () => {
    // After exactly τ the remaining gap is 1/e of the original.
    expect(predictCabinTemp(40, 20, 60, 60)).toBeCloseTo(20 + 20 / Math.E, 6);
  });

  it('returns the current temperature for a degenerate tau', () => {
    expect(predictCabinTemp(40, 20, 0, 60)).toBe(40);
    expect(predictCabinTemp(40, 20, Number.NaN, 60)).toBe(40);
  });
});

describe('minutesToReach', () => {
  it('inverts the exponential', () => {
    expect(minutesToReach(40, 20, 60, 30)).toBe(Math.round(60 * Math.LN2));
  });

  it('returns null for an unreachable target', () => {
    // Cooling toward 20 °C can never reach 15 °C.
    expect(minutesToReach(40, 20, 60, 15)).toBeNull();
    // Nor can it get further away.
    expect(minutesToReach(40, 20, 60, 45)).toBeNull();
  });

  it('returns 0 when already at ambient', () => {
    expect(minutesToReach(20, 20, 60, 20)).toBe(0);
  });
});

describe('buildSoakCurve', () => {
  it('samples the horizon at the requested step', () => {
    const curve = buildSoakCurve(40, 20, 60, 120, 30);
    expect(curve.map((p) => p.minutes)).toEqual([0, 30, 60, 90, 120]);
    expect(curve[0]!.cabinC).toBe(40);
    expect(curve[4]!.cabinC).toBeLessThan(curve[0]!.cabinC);
  });

  it('returns an empty curve for degenerate inputs', () => {
    expect(buildSoakCurve(40, 20, 0, 120)).toEqual([]);
    expect(buildSoakCurve(40, 20, 60, 120, 0)).toEqual([]);
  });
});
