import { describe, expect, it } from 'vitest';
import { containerBand, containerPolicy, packCardRows, progressValue, thinTickIndices, type CardSize } from './layoutPolicy';

describe('layout reference container policy (source tests; runtime geometry is separate)', () => {
  it.each([
    [375, 'phone', 1, 200, 3], [639, 'phone', 1, 200, 3],
    [640, 'tablet', 6, 240, 4], [1023, 'tablet', 6, 240, 4],
    [1024, 'desktop', 12, 280, 5], [1599, 'desktop', 12, 280, 5],
    [1600, 'wide', 12, 280, 6], [1920, 'wide', 12, 280, 6],
  ] as const)('uses containing width %i, not viewport width', (width, band, columns, chartHeight, gutter) => {
    expect(containerPolicy(width)).toEqual({ band, columns, chartHeight, gutter });
  });

  it('does not pretend an invalid/unmeasured width is desktop', () => {
    expect(containerBand(Number.NaN)).toBe('phone');
    expect(containerPolicy(0).columns).toBe(1);
  });

  it('expands an orphan in place and does not mutate input or reorder', () => {
    const sizes: readonly CardSize[] = Object.freeze(['half', 'half', 'half']);
    expect(packCardRows(sizes, 1280)).toEqual([6, 6, 12]);
    expect(sizes).toEqual(['half', 'half', 'half']);
    expect(packCardRows(sizes, 768)).toEqual([6, 6, 6]);
    expect(packCardRows(sizes, 375)).toEqual([1, 1, 1]);
  });

  it('fills mixed incomplete rows without dense placement or fabricated cards', () => {
    expect(packCardRows(['third', 'quarter', 'half'], 1280)).toEqual([7, 5, 12]);
    expect(packCardRows(['quarter', 'quarter', 'quarter'], 768)).toEqual([3, 3, 6]);
    expect(packCardRows([], 1280)).toEqual([]);
  });

  it('bounds tick count, retains endpoints and never repeats adjacent ticks', () => {
    for (const width of [64, 200, 375, 768, 1280, 1920]) {
      const ticks = thinTickIndices(60, width);
      expect(ticks.length).toBeLessThanOrEqual(Math.max(1, Math.floor(width / 64)));
      expect(ticks[0]).toBe(0);
      expect(new Set(ticks).size).toBe(ticks.length);
      if (ticks.length > 1) expect(ticks.at(-1)).toBe(59);
    }
    expect(thinTickIndices(0, 375)).toEqual([]);
  });

  it('never invents an unlock ratio for invalid or missing thresholds', () => {
    expect(progressValue(2, 9)).toBeCloseTo(2 / 9);
    expect(progressValue(12, 9)).toBe(1);
    expect(progressValue(-1, 9)).toBe(0);
    expect(progressValue(2, 0)).toBeNull();
    expect(progressValue(Number.NaN, 9)).toBeNull();
  });
});
