import { describe, expect, it } from 'vitest';
import { converter, wcagContrast } from 'culori';
import { CHART_SEQUENTIAL, CHART_SEQUENTIAL_DARK } from '../colors';
import { createHeatmapScale } from '../heatmap';

describe('activity heatmap scale', () => {
  it('distributes ordinary active values even with an extreme outlier and many idle days', () => {
    const active = [...Array.from({ length: 39 }, (_, i) => i + 1), 1000000];
    const scale = createHeatmapScale([...Array(300).fill(0), ...active]);
    expect([1, 2, 3, 4].map(level => active.filter(value => scale(value) === level).length))
      .toEqual([10, 10, 10, 10]);
    expect(scale(0)).toBe(0);
    expect(scale(null)).toBeNull();
    expect(scale(Number.NaN)).toBeNull();
  });

  it('keeps ties together and gives few/equal values stable, non-extreme levels', () => {
    expect([5, 5, 5].map(createHeatmapScale([5, 5, 5]))).toEqual([2, 2, 2]);
    expect(createHeatmapScale([5])(5)).toBe(2);
    expect([5, 10].map(createHeatmapScale([5, 10]))).toEqual([1, 4]);
    expect([1, 2, 2, 3].map(createHeatmapScale([1, 2, 2, 3]))).toEqual([1, 3, 3, 4]);
  });

  it('handles empty, negative and non-finite data without inventing activity', () => {
    const scale = createHeatmapScale([0, -1, NaN, Infinity]);
    expect(scale(0)).toBe(0);
    expect(scale(-1)).toBeNull();
    expect(scale(Infinity)).toBeNull();
    expect(createHeatmapScale([])(0)).toBe(0);
  });
});

describe('activity heatmap palette', () => {
  const oklch = converter('oklch');
  it.each([
    ['light', CHART_SEQUENTIAL, ['#ffffff', '#fafbfc', '#f1f5f9'], -1],
    ['dark', CHART_SEQUENTIAL_DARK, ['#11151c', '#171c25', '#434c5e'], 1],
  ] as const)('%s active levels contrast with card surfaces and separate perceptually', (_theme, palette, surfaces, direction) => {
    const active = palette.slice(1);
    expect(active).toHaveLength(4);
    for (const color of active) {
      for (const surface of surfaces) expect(wcagContrast(color, surface)).toBeGreaterThanOrEqual(3);
    }
    for (let i = 1; i < active.length; i++) {
      expect((oklch(active[i])!.l - oklch(active[i - 1])!.l) * direction).toBeGreaterThanOrEqual(0.06);
    }
  });
});
