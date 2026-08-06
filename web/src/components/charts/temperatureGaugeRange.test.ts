/**
 * temperatureGaugeRange — correct bounds for temperature gauges.
 *
 * The helper exists to stop callers converting one end of a gauge range and
 * forgetting the other. Temperature is an interval scale, so an arc computed
 * as value/max is not preserved across a unit conversion; only
 * (v - min)/(max - min) with BOTH ends converted is. These tests pin the
 * unit-invariance property directly rather than asserting specific numbers, so
 * they stay meaningful if the default bounds are ever retuned.
 */

import { describe, it, expect } from 'vitest';

import {
  temperatureGaugeRange,
  ambientTemperatureGaugeRange,
  AMBIENT_TEMP_MIN_C,
  AMBIENT_TEMP_MAX_C,
} from './temperatureGaugeRange';

const toC = (c: number) => c;
const toF = (c: number) => (c * 9) / 5 + 32;

/** The fraction of the ring a reading fills, exactly as RadialGauge computes it. */
function fillFraction(valueC: number, toDisplay: (c: number) => number, range: { min: number; max: number }) {
  const v = toDisplay(valueC);
  const clamped = Math.max(range.min, Math.min(v, range.max));
  return (clamped - range.min) / (range.max - range.min);
}

describe('temperatureGaugeRange — both ends converted', () => {
  it('converts the floor and the ceiling with the caller converter', () => {
    expect(temperatureGaugeRange(toF, { minC: 0, maxC: 100 })).toEqual({ min: 32, max: 212 });
  });

  it('defaults the floor to 0 °C for component temperatures', () => {
    expect(temperatureGaugeRange(toC, { maxC: 150 })).toEqual({ min: 0, max: 150 });
  });

  it('passes the converted zero through, not a literal zero', () => {
    // The whole point: in °F the floor is 32, not 0.
    expect(temperatureGaugeRange(toF, { maxC: 150 }).min).toBe(32);
  });
});

describe('temperatureGaugeRange — unit invariance (the bug this prevents)', () => {
  it.each([-20, -5, 0, 20, 37, 50])(
    'sweeps the same fraction at %d °C whether displayed in °C or °F',
    (tempC) => {
      const c = fillFraction(tempC, toC, ambientTemperatureGaugeRange(toC));
      const f = fillFraction(tempC, toF, ambientTemperatureGaugeRange(toF));
      expect(f).toBeCloseTo(c, 10);
    },
  );

  it.each([0, 25, 80, 120, 150])(
    'holds the same invariance for a component range at %d °C',
    (tempC) => {
      const opts = { maxC: 150 };
      const c = fillFraction(tempC, toC, temperatureGaugeRange(toC, opts));
      const f = fillFraction(tempC, toF, temperatureGaugeRange(toF, opts));
      expect(f).toBeCloseTo(c, 10);
    },
  );

  it('demonstrates the old single-ended scale really did diverge', () => {
    // Guard against someone "simplifying" back to min=0: 20 °C on a 0→50 ring
    // is 40%, but 68 °F on a 0→122 ring is 55.7%.
    const naiveC = 20 / 50;
    const naiveF = toF(20) / toF(50);
    expect(naiveF).not.toBeCloseTo(naiveC, 3);
  });
});

describe('ambientTemperatureGaugeRange — sub-zero readings', () => {
  it('starts below freezing so cold outside temperatures are not clamped away', () => {
    expect(AMBIENT_TEMP_MIN_C).toBeLessThan(0);
    expect(AMBIENT_TEMP_MAX_C).toBeGreaterThan(40);
  });

  it('renders a sub-zero reading as a non-empty arc', () => {
    const f = fillFraction(-10, toC, ambientTemperatureGaugeRange(toC));
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });

  it('distinguishes two different sub-zero readings', () => {
    // A 0-floored ring collapsed every freezing temperature to an empty arc.
    const range = ambientTemperatureGaugeRange(toC);
    expect(fillFraction(-15, toC, range)).not.toBeCloseTo(fillFraction(-5, toC, range), 3);
  });

  it('puts the freezing point at the same place in both units', () => {
    expect(fillFraction(0, toF, ambientTemperatureGaugeRange(toF))).toBeCloseTo(
      fillFraction(0, toC, ambientTemperatureGaugeRange(toC)),
      10,
    );
  });

  it('uses the exported constants as its bounds', () => {
    expect(ambientTemperatureGaugeRange(toC)).toEqual({
      min: AMBIENT_TEMP_MIN_C,
      max: AMBIENT_TEMP_MAX_C,
    });
  });
});
