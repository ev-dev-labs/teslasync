import { describe, it, expect } from 'vitest';

import { resolveBreakpointFromWidth, GRID_BREAKPOINTS } from '../useDashboardLayout';

/**
 * The breakpoint resolver must mirror react-grid-layout's
 * `getBreakpointFromWidth` EXACTLY (strict `>` over ascending thresholds).
 * At an exact threshold width (768px iPad portrait, snapped 1200px window)
 * `>=` would pick the larger breakpoint while RGL renders the smaller one,
 * and every size/arrange/persist decision would land on the wrong layout.
 */
describe('resolveBreakpointFromWidth', () => {
  it('resolves well inside each band', () => {
    expect(resolveBreakpointFromWidth(2000)).toBe('lg');
    expect(resolveBreakpointFromWidth(1100)).toBe('md');
    expect(resolveBreakpointFromWidth(900)).toBe('sm');
    expect(resolveBreakpointFromWidth(700)).toBe('xs');
    expect(resolveBreakpointFromWidth(320)).toBe('xs');
  });

  it('uses strict `>` at exact thresholds (mirrors RGL)', () => {
    expect(GRID_BREAKPOINTS.lg).toBe(1200);
    expect(resolveBreakpointFromWidth(1200)).toBe('md');
    expect(resolveBreakpointFromWidth(1201)).toBe('lg');

    expect(GRID_BREAKPOINTS.md).toBe(996);
    expect(resolveBreakpointFromWidth(996)).toBe('sm');
    expect(resolveBreakpointFromWidth(997)).toBe('md');

    expect(GRID_BREAKPOINTS.sm).toBe(768);
    expect(resolveBreakpointFromWidth(768)).toBe('xs');
    expect(resolveBreakpointFromWidth(769)).toBe('sm');
  });

  it('falls back to xs for degenerate widths', () => {
    expect(resolveBreakpointFromWidth(0)).toBe('xs');
    expect(resolveBreakpointFromWidth(-10)).toBe('xs');
  });
});
