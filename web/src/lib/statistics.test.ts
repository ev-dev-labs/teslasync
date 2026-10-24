import { describe, expect, it } from 'vitest';
import { betaQuantile, regularizedIncompleteBeta } from './statistics';

describe('regularizedIncompleteBeta', () => {
  it('matches textbook and closed-form values', () => {
    expect(regularizedIncompleteBeta(0.25, 1, 1)).toBeCloseTo(0.25, 12);
    expect(regularizedIncompleteBeta(0.8, 1, 1)).toBeCloseTo(0.8, 12);
    expect(regularizedIncompleteBeta(0.5, 2, 1)).toBeCloseTo(0.25, 12);
    expect(regularizedIncompleteBeta(0.5, 2, 3)).toBeCloseTo(0.6875, 12);
    expect(regularizedIncompleteBeta(0.5, 1.5, 1.5)).toBeCloseTo(0.5, 12);
  });

  it('is symmetric', () => {
    const x = 0.37;
    const a = 3;
    const b = 5;
    expect(regularizedIncompleteBeta(x, a, b)).toBeCloseTo(
      1 - regularizedIncompleteBeta(1 - x, b, a),
      12,
    );
  });

  it('handles endpoints', () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });

  it.each([
    [-0.1, 2, 3],
    [1.1, 2, 3],
    [Number.NaN, 2, 3],
    [Number.POSITIVE_INFINITY, 2, 3],
    [0.5, 0, 3],
    [0.5, -2, 3],
    [0.5, Number.NaN, 3],
    [0.5, Number.POSITIVE_INFINITY, 3],
    [0.5, 2, 0],
    [0.5, 2, -3],
    [0.5, 2, Number.NaN],
    [0.5, 2, Number.NEGATIVE_INFINITY],
  ])('rejects invalid or non-finite input: %p, %p, %p', (x, a, b) => {
    expect(regularizedIncompleteBeta(x, a, b)).toBeNaN();
  });

  it('rejects degenerate finite shape sums that overflow', () => {
    expect(regularizedIncompleteBeta(0.5, 1e308, 1e308)).toBeNaN();
    expect(regularizedIncompleteBeta(0.5, Number.MAX_VALUE, 1)).toBeNaN();
  });
});

describe('betaQuantile', () => {
  it('matches textbook uniform and symmetric quantiles', () => {
    expect(betaQuantile(0.25, 1, 1)).toBeCloseTo(0.25, 10);
    expect(betaQuantile(0.75, 1, 1)).toBeCloseTo(0.75, 10);
    expect(betaQuantile(0.5, 5, 5)).toBeCloseTo(0.5, 12);
  });

  it('maps endpoints exactly', () => {
    expect(betaQuantile(0, 2, 3)).toBe(0);
    expect(betaQuantile(1, 2, 3)).toBe(1);
  });

  it.each([
    [-0.1, 2, 3],
    [1.1, 2, 3],
    [Number.NaN, 2, 3],
    [Number.POSITIVE_INFINITY, 2, 3],
    [0.5, 0, 3],
    [0.5, -2, 3],
    [0.5, Number.NaN, 3],
    [0.5, Number.POSITIVE_INFINITY, 3],
    [0.5, 2, 0],
    [0.5, 2, -3],
    [0.5, 2, Number.NaN],
    [0.5, 2, Number.NEGATIVE_INFINITY],
  ])('rejects invalid or non-finite input: %p, %p, %p', (p, a, b) => {
    expect(betaQuantile(p, a, b)).toBeNaN();
  });

  it('rejects degenerate finite shape sums that overflow', () => {
    expect(betaQuantile(0.5, 1e308, 1e308)).toBeNaN();
    expect(betaQuantile(0.5, Number.MAX_VALUE, 1)).toBeNaN();
  });

  it('is symmetric and has CDF/quantile parity', () => {
    for (const [a, b] of [[1.5, 4], [2, 3], [5, 5], [0.5, 0.5]]) {
      for (const p of [0.025, 0.1, 0.5, 0.975]) {
        const q = betaQuantile(p, a!, b!);
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThanOrEqual(1);
        expect(regularizedIncompleteBeta(q, a!, b!)).toBeCloseTo(p, 8);
        expect(betaQuantile(1 - p, b!, a!)).toBeCloseTo(1 - q, 7);
      }
    }
  });
});
