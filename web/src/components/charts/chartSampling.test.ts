import { describe, expect, it } from 'vitest';
import { downsampleChartRows } from './chartSampling';

describe('downsampleChartRows', () => {
  it('returns all rows with an honest unsampled disclosure below the cap', () => {
    const source = [{ x: 1 }, { x: 2 }];
    expect(downsampleChartRows(source, 10)).toEqual({
      rows: source,
      disclosure: {
        sourceCount: 2,
        renderedCount: 2,
        sampled: false,
        strategy: 'none',
      },
    });
  });

  it('deterministically caps dense rows and retains the time-window boundaries', () => {
    const source = Array.from({ length: 101 }, (_, x) => ({ x }));
    const result = downsampleChartRows(source, 10);

    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]).toEqual({ x: 0 });
    expect(result.rows.at(-1)).toEqual({ x: 100 });
    expect(result.disclosure).toEqual({
      sourceCount: 101,
      renderedCount: 10,
      sampled: true,
      strategy: 'stride',
    });
    expect(downsampleChartRows(source, 10)).toEqual(result);
  });

  it('handles nullish data and malformed caps without throwing', () => {
    expect(downsampleChartRows(null, 0)).toEqual({
      rows: [],
      disclosure: {
        sourceCount: 0,
        renderedCount: 0,
        sampled: false,
        strategy: 'none',
      },
    });
  });

});
