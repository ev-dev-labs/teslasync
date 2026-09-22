import type { DensityMode, ModularRatio, TypographySpec } from './types';

/** Multipliers for each named modular ratio. */
export const RATIO_VALUES: Record<ModularRatio, number> = {
  minorSecond: 1.067,
  majorSecond: 1.125,
  minorThird: 1.2,
  majorThird: 1.25,
  perfectFourth: 1.333,
  goldenRatio: 1.618,
};

/** Leading multipliers per density mode. */
export const DENSITY_MULTIPLIERS: Record<DensityMode, number> = {
  compact: 0.9,
  comfortable: 1.0,
  relaxed: 1.15,
};

/** Optical leading model: base minus a per-step decrement, floored. */
export const LEADING_BASE = 1.48;
export const LEADING_STEP_DELTA = 0.045;
export const LEADING_FLOOR = 1.1;

/** Optical tracking model: base minus a per-step decrement (em). */
export const TRACKING_BASE = 0.015;
export const TRACKING_STEP_DELTA = 0.007;

/**
 * Scale steps: [token name, modular exponent]. -1 is caption, 0 is body,
 * 1–6 climb h5 → display.
 */
export const SCALE_STEPS: ReadonlyArray<readonly [string, number]> = [
  ['xs', -1],
  ['base', 0],
  ['md', 1],
  ['lg', 2],
  ['xl', 3],
  ['2xl', 4],
  ['3xl', 5],
  ['4xl', 6],
];

/**
 * Transforms a typographic intent into balanced CSS Custom Properties:
 * a fluid `clamp()` size per scale step plus optically derived leading
 * (larger type needs less relative leading) and tracking (larger type
 * needs tighter spacing), scaled by the density multiplier.
 *
 * Pure — no DOM access — so the math is unit-testable in isolation.
 */
export class TypographyHarmonizer {
  public compileTokens(spec: TypographySpec): Record<string, string> {
    const ratio = RATIO_VALUES[spec.ratio];
    const densityMultiplier = DENSITY_MULTIPLIERS[spec.density];
    const tokens: Record<string, string> = {};

    for (const [name, step] of SCALE_STEPS) {
      const minPx = spec.baseSizeMinPx * Math.pow(ratio, step);
      const maxPx = spec.baseSizeMaxPx * Math.pow(ratio, step);

      // Fluid interpolation between the viewport bounds: y = mx + b.
      const slope = (maxPx - minPx) / (spec.viewportMaxPx - spec.viewportMinPx);
      const intercept = -spec.viewportMinPx * slope + minPx;

      tokens[`--type-size-${name}`] =
        `clamp(${minPx.toFixed(2)}px, ${intercept.toFixed(2)}px + ${(slope * 100).toFixed(4)}vw, ${maxPx.toFixed(2)}px)`;

      const leading = Math.max(LEADING_FLOOR, LEADING_BASE - step * LEADING_STEP_DELTA) * densityMultiplier;
      tokens[`--type-lh-${name}`] = leading.toFixed(3);

      const tracking = TRACKING_BASE - step * TRACKING_STEP_DELTA;
      tokens[`--type-track-${name}`] = `${tracking.toFixed(4)}em`;
    }

    return tokens;
  }
}
