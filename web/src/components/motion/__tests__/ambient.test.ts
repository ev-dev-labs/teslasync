/**
 * Ambient-motion helper contract (A11Y-08).
 *
 * These helpers are what keep `<VehicleTwin>`'s seventeen looping SVG
 * layers from animating forever for a user who asked the OS for less
 * motion (WCAG 2.2.2). They are pure, so the whole preference matrix is
 * asserted here without mounting a scene.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  ambientFrames,
  ambientLoop,
  prefersReducedMotion,
} from '../ambient';

/** Point `matchMedia` at a fixed answer for the reduce query. */
function setReducedMotion(reduce: boolean | 'throw' | 'missing') {
  if (reduce === 'missing') {
    // @ts-expect-error deliberately removing the API for the fallback test
    delete window.matchMedia;
    return;
  }
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    if (reduce === 'throw') throw new Error('matchMedia unavailable');
    return {
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    };
  }) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('prefersReducedMotion', () => {
  it('reports the OS preference', () => {
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    setReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('defaults to "animate" when matchMedia is unavailable', () => {
    setReducedMotion('missing');
    expect(prefersReducedMotion()).toBe(false);
  });

  it('defaults to "animate" when matchMedia throws', () => {
    setReducedMotion('throw');
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('ambientLoop', () => {
  it('passes the transition through when motion is allowed', () => {
    setReducedMotion(false);
    const transition = { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const };
    expect(ambientLoop(transition)).toBe(transition);
  });

  it('cancels the repeat entirely under reduced motion', () => {
    setReducedMotion(true);
    const result = ambientLoop({ duration: 2.4, repeat: Infinity }) as {
      duration: number;
      repeat: number;
    };
    // A zero-duration INFINITE repeat still schedules a callback every
    // frame — the repeat itself has to go, not just the duration.
    expect(result.repeat).toBe(0);
    expect(result.duration).toBe(0);
  });
});

describe('ambientFrames', () => {
  it('passes the target through when motion is allowed', () => {
    setReducedMotion(false);
    const target = { opacity: [0.2, 0.55, 0.2] };
    expect(ambientFrames(target)).toBe(target);
  });

  it('collapses keyframes to the resting frame under reduced motion', () => {
    setReducedMotion(true);
    expect(ambientFrames({ opacity: [0.2, 0.55, 0.2], rx: [160, 205, 160] })).toEqual({
      opacity: 0.2,
      rx: 160,
    });
  });

  it('leaves scalar values untouched in a mixed target', () => {
    setReducedMotion(true);
    expect(ambientFrames({ opacity: [0.3, 1, 0.3], scale: 1 })).toEqual({
      opacity: 0.3,
      scale: 1,
    });
  });

  it('never picks the peak frame, which would leave glows stuck on', () => {
    setReducedMotion(true);
    const result = ambientFrames({ opacity: [0, 0.72, 0.18, 0.58, 0.12] }) as {
      opacity: number;
    };
    expect(result.opacity).toBe(0);
  });

  it('tolerates an empty keyframe array', () => {
    setReducedMotion(true);
    expect(ambientFrames({ opacity: [] })).toEqual({ opacity: [] });
  });
});
