import { TypographyHarmonizer, RATIO_VALUES, SCALE_STEPS } from './harmonizer';
import type { TypographySpec } from './types';

const SPEC: TypographySpec = {
  ratio: 'majorThird',
  baseSizeMinPx: 15,
  baseSizeMaxPx: 17,
  viewportMinPx: 360,
  viewportMaxPx: 1440,
  density: 'comfortable',
};

describe('TypographyHarmonizer', () => {
  const tokens = new TypographyHarmonizer().compileTokens(SPEC);

  it('emits size, leading, and tracking tokens for every scale step', () => {
    expect(Object.keys(tokens)).toHaveLength(SCALE_STEPS.length * 3);
    for (const [name] of SCALE_STEPS) {
      expect(tokens[`--type-size-${name}`]).toMatch(/^clamp\(/);
      expect(tokens[`--type-lh-${name}`]).toMatch(/^\d+\.\d+$/);
      expect(tokens[`--type-track-${name}`]).toMatch(/^-?\d+\.\d+em$/);
    }
  });

  it('derives body clamp bounds from the base sizes', () => {
    // ratio^0 = 1, so step 0 clamps exactly between the base sizes.
    expect(tokens['--type-size-base']).toBe('clamp(15.00px, 14.33px + 0.1852vw, 17.00px)');
  });

  it('scales steps geometrically by the modular ratio', () => {
    const h5 = tokens['--type-size-md'];
    const expected = 15 * RATIO_VALUES.majorThird;
    expect(h5.startsWith(`clamp(${expected.toFixed(2)}px,`)).toBe(true);
  });

  it('reduces relative leading as type grows, floored at 1.10', () => {
    const xs = parseFloat(tokens['--type-lh-xs']);
    const base = parseFloat(tokens['--type-lh-base']);
    const display = parseFloat(tokens['--type-lh-4xl']);
    expect(xs).toBeGreaterThan(base);
    expect(base).toBeGreaterThan(display);
    expect(display).toBeGreaterThanOrEqual(1.1);
  });

  it('tightens tracking as type grows', () => {
    const xs = parseFloat(tokens['--type-track-xs']);
    const display = parseFloat(tokens['--type-track-4xl']);
    expect(xs).toBeGreaterThan(0);
    expect(display).toBeLessThan(0);
  });

  it('scales leading by the density multiplier', () => {
    const harmonizer = new TypographyHarmonizer();
    const compact = harmonizer.compileTokens({ ...SPEC, density: 'compact' });
    const relaxed = harmonizer.compileTokens({ ...SPEC, density: 'relaxed' });
    const base = parseFloat(tokens['--type-lh-base']);
    expect(parseFloat(compact['--type-lh-base'])).toBeCloseTo(base * 0.9, 3);
    expect(parseFloat(relaxed['--type-lh-base'])).toBeCloseTo(base * 1.15, 3);
  });
});
