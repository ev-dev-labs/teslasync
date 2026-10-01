import { describe, it, expect } from 'vitest';

import { layoutsEqual, rowsForHeight } from '../dashboardLayoutActions';
import type { RGLLayouts } from '../../widgets/types';

const base: RGLLayouts = {
  lg: [
    { i: 'a', x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 2, maxW: 4, maxH: 40 },
    { i: 'b', x: 1, y: 0, w: 2, h: 2 },
  ],
  md: [{ i: 'a', x: 0, y: 0, w: 1, h: 2 }],
};

describe('layoutsEqual', () => {
  it('treats identical layouts as equal', () => {
    expect(layoutsEqual(base, structuredClone(base))).toBe(true);
  });

  it('ignores item order (compactors reorder freely)', () => {
    const reordered: RGLLayouts = {
      lg: [base.lg[1], base.lg[0]],
      md: [...base.md],
    };
    expect(layoutsEqual(base, reordered)).toBe(true);
  });

  it('ignores incidental fields (moved, static)', () => {
    const noisy = structuredClone(base);
    (noisy.lg[0] as Record<string, unknown>).moved = true;
    (noisy.lg[1] as Record<string, unknown>).static = true;
    expect(layoutsEqual(base, noisy)).toBe(true);
  });

  it('detects geometry changes', () => {
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const changed = structuredClone(base);
      (changed.lg[0] as Record<string, unknown>)[key] = 99;
      expect(layoutsEqual(base, changed), key).toBe(false);
    }
  });

  it('detects constraint changes', () => {
    const changed = structuredClone(base);
    changed.lg[0].maxH = 3;
    expect(layoutsEqual(base, changed)).toBe(false);
  });

  it('detects item-set and breakpoint-set changes', () => {
    expect(layoutsEqual(base, { ...base, lg: [base.lg[0]] })).toBe(false);
    expect(layoutsEqual(base, { lg: base.lg })).toBe(false);
    expect(layoutsEqual(base, undefined)).toBe(false);
    expect(layoutsEqual(undefined, undefined)).toBe(true);
  });
});

describe('rowsForHeight', () => {
  const RH = 80;
  const M = 16;

  it('inverts the RGL box equation exactly', () => {
    // boxH(h) = h*80 + (h-1)*16 → h1=80, h2=176, h3=272
    expect(rowsForHeight(80, RH, M)).toBe(1);
    expect(rowsForHeight(176, RH, M)).toBe(2);
    expect(rowsForHeight(272, RH, M)).toBe(3);
  });

  it('grows a full row for any positive overflow (rows are atomic)', () => {
    expect(rowsForHeight(81, RH, M)).toBe(2);
    expect(rowsForHeight(177, RH, M)).toBe(3);
    expect(rowsForHeight(500, RH, M)).toBe(6); // ceil(516/96)
  });

  it('returns 1 row for degenerate input', () => {
    expect(rowsForHeight(0, RH, M)).toBe(1);
    expect(rowsForHeight(-50, RH, M)).toBe(1);
    expect(rowsForHeight(Number.NaN, RH, M)).toBe(1);
  });

  it('honours compact margins', () => {
    // boxH(h) = h*80 + (h-1)*8 → h2=168
    expect(rowsForHeight(168, RH, 8)).toBe(2);
    expect(rowsForHeight(169, RH, 8)).toBe(3);
  });
});
