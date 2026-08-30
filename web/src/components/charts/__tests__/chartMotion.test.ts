/**
 * Reduced-motion contract for charts and skeletons (A11Y-08).
 *
 * Recharts animates every series with `requestAnimationFrame`, and the
 * skeleton shimmer runs as a CSS keyframe loop. Neither is stopped by
 * the generic `animation-duration: 0.01ms` reduced-motion safety net —
 * the first because CSS cannot reach it, the second because a
 * compressed single iteration parks the highlight gradient off to one
 * side and leaves the placeholder visibly lopsided forever.
 *
 * These assertions pin the two fixes: getter-backed chart defaults, and
 * an explicit `animation: none` list in `index.css`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AREA_DEFAULTS, chartAnimationProps } from '../chartDefaults';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('AREA_DEFAULTS', () => {
  it('animates by default', () => {
    setReducedMotion(false);
    const spread = { ...AREA_DEFAULTS };
    expect(spread.isAnimationActive).toBe(true);
    expect(spread.animationDuration).toBeGreaterThan(0);
  });

  it('disables Recharts animation under reduced motion', () => {
    setReducedMotion(true);
    const spread = { ...AREA_DEFAULTS };
    expect(spread.isAnimationActive).toBe(false);
    expect(spread.animationDuration).toBe(0);
  });

  it('re-reads the preference on every spread, not once at import', () => {
    // This is the whole point of the getter form: ~225 call sites spread
    // the object at render time and must observe the CURRENT preference
    // without any of them adding a hook.
    setReducedMotion(false);
    expect({ ...AREA_DEFAULTS }.isAnimationActive).toBe(true);
    setReducedMotion(true);
    expect({ ...AREA_DEFAULTS }.isAnimationActive).toBe(false);
    setReducedMotion(false);
    expect({ ...AREA_DEFAULTS }.isAnimationActive).toBe(true);
  });

  it('keeps the non-motion defaults intact', () => {
    setReducedMotion(true);
    const spread = { ...AREA_DEFAULTS };
    expect(spread.type).toBe('monotone');
    expect(spread.dot).toBe(false);
    // A gap in telemetry must stay a gap, reduced motion or not.
    expect(spread.connectNulls).toBe(false);
  });
});

describe('chartAnimationProps', () => {
  it('covers primitives that do not spread AREA_DEFAULTS', () => {
    setReducedMotion(false);
    expect(chartAnimationProps()).toEqual({
      isAnimationActive: true,
      animationDuration: 300,
    });
    setReducedMotion(true);
    expect(chartAnimationProps()).toEqual({
      isAnimationActive: false,
      animationDuration: 0,
    });
  });
});

describe('global reduced-motion CSS', () => {
  const css = readFileSync(join('src', 'index.css'), 'utf8');

  /** Text between the braces of the reduced-motion media block. */
  function reducedMotionBlock(): string {
    const start = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    expect(start).toBeGreaterThan(-1);
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) return css.slice(open, i);
      }
    }
    throw new Error('unbalanced prefers-reduced-motion block');
  }

  it.each([
    '.animate-pulse',
    '.animate-shimmer',
    '.animate-skeleton-wave',
    '.shimmer',
    '.pulse-glow',
  ])('stops the %s loop outright', (selector) => {
    const block = reducedMotionBlock();
    expect(block).toContain(selector);
  });

  it('sets animation: none rather than only compressing the duration', () => {
    expect(reducedMotionBlock()).toMatch(/animation:\s*none\s*!important/);
  });
});
