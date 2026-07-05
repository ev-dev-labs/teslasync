/**
 * route-efficiency/helpers — behaviour + hardening coverage.
 *
 * Two pure exports back the Route Efficiency page's RouteCard. This suite
 * exercises every branch plus the real bugs the hardening fixed:
 *   - `efficiencyVariant` — the four-band Wh/km classifier, its 140 / 180 / 220
 *     boundaries, negative (net-regen) input, and the non-finite guard. The
 *     pre-fix version let NaN / ±Infinity fall through every `<` comparison to
 *     the worst 'danger' band, so a degraded or divide-by-zero efficiency
 *     rendered a red badge over a value the display collapsed to "0". It now
 *     lands in the best/neutral 'success' band, matching the caller's
 *     `?? 0 → 'success'` path.
 *   - `makeUnitDisplay` — the display-boundary unit bag. `toDistance` /
 *     `toEfficiency` now route through `safeNumber`, so null / undefined / NaN /
 *     ±Infinity collapse to 0 instead of `?? 0` only catching nullish input and
 *     letting a NaN poison RouteCard's range-bar gradient math
 *     (`Math.max(NaN, 1)` → NaN → a broken `NaN%` CSS stop).
 *
 * Pure logic: no components, hooks, network, or timers are involved, so this
 * follows the repo's existing `helpers.test.ts` convention (plain Vitest, no
 * RTL / MSW needed).
 */
import { describe, it, expect } from 'vitest';
import { safeNumber } from '@/lib/numberFormat';
import { efficiencyVariant, makeUnitDisplay, type EfficiencyVariant } from './helpers';

/** 1 mile in kilometres — the Wh/km → Wh/mi scaling factor (mirrors helpers.ts). */
const KM_PER_MILE = 1.609344;
/** 1 metre in feet — for the 'ft' distance-branch assertions. */
const FEET_PER_METER = 1 / 0.3048;

describe('efficiencyVariant', () => {
  it('classifies each Wh/km band at a representative interior value', () => {
    expect(efficiencyVariant(100)).toBe('success'); // < 140
    expect(efficiencyVariant(160)).toBe('info'); // [140, 180)
    expect(efficiencyVariant(200)).toBe('warning'); // [180, 220)
    expect(efficiencyVariant(300)).toBe('danger'); // >= 220
  });

  it('flips exactly on the 140 / 180 / 220 boundaries (lower bound inclusive)', () => {
    expect(efficiencyVariant(139.99)).toBe('success');
    expect(efficiencyVariant(140)).toBe('info'); // 140 is no longer success
    expect(efficiencyVariant(179.99)).toBe('info');
    expect(efficiencyVariant(180)).toBe('warning'); // 180 flips
    expect(efficiencyVariant(219.99)).toBe('warning');
    expect(efficiencyVariant(220)).toBe('danger'); // 220 flips
  });

  it('treats zero and negative (net-regen) efficiency as the best success band', () => {
    expect(efficiencyVariant(0)).toBe('success');
    expect(efficiencyVariant(-50)).toBe('success'); // downhill route with net regen
  });

  it('guards non-finite input to success instead of falling through to danger', () => {
    // Pre-fix bug: NaN / ±Infinity failed every `<` comparison and returned
    // 'danger', painting a red badge over a value the display shows as "0".
    expect(efficiencyVariant(Number.NaN)).toBe('success');
    expect(efficiencyVariant(Number.POSITIVE_INFINITY)).toBe('success');
    expect(efficiencyVariant(Number.NEGATIVE_INFINITY)).toBe('success');
  });

  it('pairs a non-finite efficiency with the same "0" the display renders (regression)', () => {
    // Badge colour (efficiencyVariant) and Badge text (safeNumber via fmtInt)
    // must agree: both collapse a NaN efficiency to the empty/success state, so
    // a missing figure can never show a 'danger' badge over a "0 Wh/km" readout.
    expect(efficiencyVariant(Number.NaN)).toBe('success');
    expect(safeNumber(Number.NaN)).toBe(0);
  });

  it('always returns one of the four defined variants across a sweep', () => {
    const palette = new Set<EfficiencyVariant>(['success', 'info', 'warning', 'danger']);
    for (const w of [-100, 0, 139, 140, 179, 180, 219, 220, 500, Number.NaN, Infinity]) {
      expect(palette.has(efficiencyVariant(w))).toBe(true);
    }
  });
});

describe('makeUnitDisplay', () => {
  it('exposes the metric label + identity efficiency for the km preference', () => {
    const u = makeUnitDisplay('km');
    expect(u.distanceUnit).toBe('km');
    expect(u.efficiencyUnit).toBe('Wh/km');
    expect(u.toDistance(1000)).toBe(1); // 1000 m → 1 km
    expect(u.toDistance(2500)).toBe(2.5);
    expect(u.toEfficiency(150)).toBe(150); // Wh/km is unchanged in metric
  });

  it('exposes the imperial label + scaled efficiency for the mi preference', () => {
    const u = makeUnitDisplay('mi');
    expect(u.distanceUnit).toBe('mi');
    expect(u.efficiencyUnit).toBe('Wh/mi');
    expect(u.toDistance(1609.344)).toBeCloseTo(1, 10); // exactly one mile
    expect(u.toDistance(3218.688)).toBeCloseTo(2, 10);
    // Wh/km × km-per-mile = Wh/mi.
    expect(u.toEfficiency(100)).toBeCloseTo(100 * KM_PER_MILE, 10);
    expect(u.toEfficiency(1)).toBeCloseTo(KM_PER_MILE, 10);
  });

  it('collapses nullish distance / efficiency to 0 for both preferences', () => {
    for (const pref of ['km', 'mi'] as const) {
      const u = makeUnitDisplay(pref);
      expect(u.toDistance(null)).toBe(0);
      expect(u.toDistance(undefined)).toBe(0);
      expect(u.toEfficiency(null)).toBe(0);
      expect(u.toEfficiency(undefined)).toBe(0);
    }
  });

  it('collapses non-finite distance / efficiency to 0 (NaN / ±Infinity)', () => {
    const u = makeUnitDisplay('mi');
    expect(u.toDistance(Number.NaN)).toBe(0);
    expect(u.toDistance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(u.toEfficiency(Number.NaN)).toBe(0);
    expect(u.toEfficiency(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('keeps the range-bar gradient math finite when an efficiency is non-finite (regression)', () => {
    // Pre-fix: toEfficiency(NaN) → NaN, and RouteCard's `Math.max(NaN, 1)` → NaN
    // emitted a broken `NaN%` gradient stop. `safeNumber` now floors it to 0.
    const u = makeUnitDisplay('km');
    const worstEff = u.toEfficiency(Number.NaN);
    expect(worstEff).toBe(0);
    const denom = Math.max(worstEff, 1);
    const bestPct = Math.min((u.toEfficiency(120) / denom) * 100, 100);
    expect(Number.isFinite(bestPct)).toBe(true);
    expect(bestPct).toBe(100);
  });

  it('routes any non-mile preference through the metric efficiency branch (ft)', () => {
    // 'ft' is a valid DistanceUnitPref but never used for route distances; this
    // documents that only 'mi' scales efficiency — every other unit keeps Wh/km.
    const u = makeUnitDisplay('ft');
    expect(u.distanceUnit).toBe('ft');
    expect(u.efficiencyUnit).toBe('Wh/km');
    expect(u.toEfficiency(150)).toBe(150); // no imperial scaling
    expect(u.toDistance(1000)).toBeCloseTo(FEET_PER_METER * 1000, 6); // 1000 m → ~3280.84 ft
  });
});
