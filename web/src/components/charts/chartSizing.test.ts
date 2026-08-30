import { describe, expect, it } from 'vitest';

import {
  chartSizeHeights,
  chartViewportStyle,
  resolveChartHeights,
} from './chartSizing';

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

  it('preserves legitimate explicit compact and tall caller heights', () => {
    expect(resolveChartHeights('standard', 120)).toEqual({
      mobile: 120,
      desktop: 120,
    });
    expect(resolveChartHeights('standard', 1_024, 900)).toEqual({
      mobile: 900,
      desktop: 1_024,
    });
  });

  it.each([390, 768, 1440])(
    'keeps fixed viewport values across repeated rerenders at %ipx',
    () => {
      const initial = resolveChartHeights('detail', 480, 320);
      for (let render = 0; render < 25; render += 1) {
        expect(chartViewportStyle(resolveChartHeights('detail', 480, 320))).toEqual(
          chartViewportStyle(initial),
        );
      }
      expect(chartViewportStyle(initial)).toEqual({
        '--chart-height-mobile': '320px',
        '--chart-height-desktop': '480px',
      });
    },
  );
});
