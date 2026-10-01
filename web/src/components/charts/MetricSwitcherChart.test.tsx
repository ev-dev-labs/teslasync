import { describe, expect, it } from 'vitest';
import { resolveYAxisProps } from './MetricSwitcherChart';

describe('resolveYAxisProps', () => {
  it('forces integer ticks for integer-only series', () => {
    // The "1, 1, 1, 0, 0" axis: fractional ticks over a [0, 1] domain all
    // round to the same labels. Integer data must never see them.
    expect(resolveYAxisProps([0, 1, 1, 0], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
  });

  it('keeps decimal ticks when any value is fractional', () => {
    expect(resolveYAxisProps([0.9, 1.2], 'bar')).toEqual({
      allowDecimals: true,
      domain: [0, 2.2],
    });
  });

  it('pins bar floors at zero with headroom above the max', () => {
    // A lone small bar gets a [0, 2] frame instead of filling the chart.
    expect(resolveYAxisProps([1], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
    expect(resolveYAxisProps([40, 100], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 110],
    });
  });

  it('renders an all-zero bar series as a flat baseline, not a degenerate axis', () => {
    expect(resolveYAxisProps([0, 0, 0], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
  });

  it('leaves line and area domains automatic — their values live far from zero', () => {
    expect(resolveYAxisProps([280, 295], 'line')).toEqual({
      allowDecimals: false,
      domain: ['auto', 'auto'],
    });
    expect(resolveYAxisProps([280.5, 295.1], 'area')).toEqual({
      allowDecimals: true,
      domain: ['auto', 'auto'],
    });
  });

  it('falls back to automatic for negative or empty bar data', () => {
    expect(resolveYAxisProps([-5, 10], 'bar')).toEqual({
      allowDecimals: false,
      domain: ['auto', 'auto'],
    });
    expect(resolveYAxisProps([], 'bar')).toEqual({
      allowDecimals: true,
      domain: ['auto', 'auto'],
    });
  });

  it('ignores non-finite values', () => {
    expect(resolveYAxisProps([1, Number.NaN, Number.POSITIVE_INFINITY], 'bar')).toEqual({
      allowDecimals: false,
      domain: [0, 2],
    });
  });
});
