import { describe, expect, it } from 'vitest';
import { dailyFixture, plotFixture } from './fixtures';

describe('explicit synthetic chart fixtures', () => {
  it('keeps the complete sixty-point fixture separate from plotted sampling', () => {
    const original = dailyFixture.map(point => ({ ...point }));
    const narrow = plotFixture(200);
    expect(narrow.length).toBeLessThan(60);
    expect(narrow[0]).toBe(dailyFixture[0]);
    expect(narrow.at(-1)).toBe(dailyFixture.at(-1));
    expect(new Set(narrow.map(point => point.index)).size).toBe(narrow.length);
    expect(dailyFixture).toEqual(original);
    expect(dailyFixture).toHaveLength(60);
    expect(plotFixture(1920)).toBe(dailyFixture);
  });
});
