import { describe, expect, it } from 'vitest';

import { chartSizeHeights, resolveChartHeights } from './chartSizing';

describe('resolveChartHeights', () => {
  it('uses the standard responsive preset by default', () => {
    expect(resolveChartHeights()).toEqual(chartSizeHeights.standard);
  });

  it('resolves every semantic chart size', () => {
    expect(resolveChartHeights('compact')).toEqual({ mobile: 200, desktop: 240 });
    expect(resolveChartHeights('detail')).toEqual({ mobile: 300, desktop: 360 });
    expect(resolveChartHeights('hero')).toEqual({ mobile: 340, desktop: 420 });
  });

  it('preserves a desktop override while keeping mobile height bounded', () => {
    expect(resolveChartHeights('standard', 480)).toEqual({
      mobile: 260,
      desktop: 480,
    });
    expect(resolveChartHeights('standard', 180)).toEqual({
      mobile: 180,
      desktop: 180,
    });
  });

  it('accepts an explicit mobile override and rejects invalid dimensions', () => {
    expect(resolveChartHeights('detail', 500, 320)).toEqual({
      mobile: 320,
      desktop: 500,
    });
    expect(resolveChartHeights('compact', Number.NaN, -1)).toEqual(
      chartSizeHeights.compact,
    );
  });
});
