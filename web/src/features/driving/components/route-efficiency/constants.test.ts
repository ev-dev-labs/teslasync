import { describe, it, expect } from 'vitest';

import { ROUTE_EFF_COLORS, MAX_COMPARISON_ROUTES } from './constants';
import { chartTokens } from '@/lib/tokens';

// ---------------------------------------------------------------------------
// route-efficiency/constants — the shared accent palette + comparison-chart
// row cap consumed by RouteCard and RouteEfficiencyPage.
//
// These are pure data, but they carry real, load-bearing contracts:
//   • ROUTE_EFF_COLORS is inlined into a CSS `linear-gradient(...)` in
//     RouteCard and passed as recharts `fill=` on RouteEfficiencyPage, so
//     every value MUST be a literal `#rrggbb` hex — never a `var(--x)` token
//     that a gradient string / recharts fill cannot resolve.
//   • The best/avg/worst/mostDriven → series-slot mapping encodes semantics
//     (green = lowest consumption, red = highest). A palette reorder in
//     @/lib/tokens must not silently repaint "best" red — the tests below pin
//     BOTH the wiring (which slot) and the meaning (which hue).
//   • MAX_COMPARISON_ROUTES caps `.slice(0, MAX_COMPARISON_ROUTES)` on the
//     comparison chart, so it must stay a small positive integer.
// ---------------------------------------------------------------------------

/** Parse a `#rrggbb` string into 0-255 channels. Throws on any non-hex input. */
function rgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

const ACCENT_KEYS = ['best', 'avg', 'worst', 'mostDriven'] as const;

describe('ROUTE_EFF_COLORS', () => {
  it('exposes exactly the best/avg/worst/mostDriven accents in declaration order', () => {
    expect(Object.keys(ROUTE_EFF_COLORS)).toEqual([...ACCENT_KEYS]);
  });

  it('wires each accent to its documented shared-palette slot', () => {
    // Pins the numeric index mapping so an accidental slot typo is caught.
    expect(ROUTE_EFF_COLORS.best).toBe(chartTokens.series[1]);
    expect(ROUTE_EFF_COLORS.avg).toBe(chartTokens.series[5]);
    expect(ROUTE_EFF_COLORS.worst).toBe(chartTokens.series[3]);
    expect(ROUTE_EFF_COLORS.mostDriven).toBe(chartTokens.series[4]);
  });

  it('draws every accent from the shared color-blind-safe series palette', () => {
    for (const key of ACCENT_KEYS) {
      expect(chartTokens.series).toContain(ROUTE_EFF_COLORS[key]);
    }
  });

  it('resolves every accent to a literal 6-digit hex color, never a CSS var', () => {
    const values = Object.values(ROUTE_EFF_COLORS);
    for (const value of values) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // The RouteCard gradient + recharts fills cannot resolve `var(--x)`.
    expect(values.some((v) => v.includes('var('))).toBe(false);
  });

  it('keeps the four accents visually distinct', () => {
    const values = Object.values(ROUTE_EFF_COLORS);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(values).size).toBe(4);
  });

  it('encodes consumption semantics: best is green, worst is red', () => {
    const best = rgb(ROUTE_EFF_COLORS.best);
    expect(best.g).toBeGreaterThan(best.r);
    expect(best.g).toBeGreaterThan(best.b);

    const worst = rgb(ROUTE_EFF_COLORS.worst);
    expect(worst.r).toBeGreaterThan(worst.g);
    expect(worst.r).toBeGreaterThan(worst.b);
  });

  it('encodes accent hues: avg reads cyan, mostDriven reads purple', () => {
    const avg = rgb(ROUTE_EFF_COLORS.avg);
    expect(avg.g).toBeGreaterThan(avg.r);
    expect(avg.b).toBeGreaterThan(avg.r);

    const mostDriven = rgb(ROUTE_EFF_COLORS.mostDriven);
    expect(mostDriven.b).toBeGreaterThan(mostDriven.g);
    expect(mostDriven.r).toBeGreaterThan(mostDriven.g);
  });

  it('composes into a valid RouteCard-style gradient containing each stop color', () => {
    // Mirrors the `linear-gradient(...)` built in RouteCard from these accents.
    const gradient =
      `linear-gradient(to right, ${ROUTE_EFF_COLORS.best} 0%,` +
      ` ${ROUTE_EFF_COLORS.avg} 50%, ${ROUTE_EFF_COLORS.worst} 100%)`;
    expect(gradient).toContain(ROUTE_EFF_COLORS.best);
    expect(gradient).toContain(ROUTE_EFF_COLORS.avg);
    expect(gradient).toContain(ROUTE_EFF_COLORS.worst);
  });
});

describe('MAX_COMPARISON_ROUTES', () => {
  it('is a small positive integer cap', () => {
    expect(MAX_COMPARISON_ROUTES).toBe(10);
    expect(Number.isInteger(MAX_COMPARISON_ROUTES)).toBe(true);
    expect(MAX_COMPARISON_ROUTES).toBeGreaterThan(0);
  });

  it('caps an over-long route list to at most MAX_COMPARISON_ROUTES rows', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const capped = rows.slice(0, MAX_COMPARISON_ROUTES);
    expect(capped).toHaveLength(MAX_COMPARISON_ROUTES);
    expect(capped[capped.length - 1]).toBe(9);
  });

  it('leaves a route list shorter than the cap untouched', () => {
    const few = [1, 2, 3];
    expect(few.slice(0, MAX_COMPARISON_ROUTES)).toEqual([1, 2, 3]);
  });
});
