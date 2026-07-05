/**
 * cost-analysis/helpers — behaviour + hardening coverage.
 *
 * Two pure utilities back the Cost Analysis page. This suite drives every
 * branch and the real bug the hardening fixed:
 *   - `categorizeCharger` — the four-way classifier (Supercharger → Public DC
 *     → Work/L2 → Home) including its null-safety guards, the 22 kW boundary,
 *     case-insensitivity, and the precedence between overlapping signals. The
 *     returned strings are semantic keys consumed as `CHARGER_COLORS[name]`
 *     lookups AND display labels, so they are asserted verbatim (never i18n'd).
 *   - `gasEquivalentCost` — the energy-content gasoline price. The prior
 *     `× mpg ÷ mpg` round-trip returned 0 / 0 = NaN when mpg was 0; these
 *     tests pin the correct mpg-independent result and prove the NaN can no
 *     longer reach the monthly savings columns.
 *
 * Pure logic: no components, hooks, network, or timers are involved, so this
 * follows the repo's existing `helpers.test.ts` convention (plain Vitest, no
 * RTL / MSW needed).
 */
import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/api/types';
import { categorizeCharger, gasEquivalentCost } from './helpers';
import { KWH_PER_GALLON } from './constants';

/** Build a fully-typed ChargingSession, overriding only the fields under test. */
function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2024-01-01T00:00:00Z',
    ended_at: '2024-01-01T01:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 0,
    end_odometer_m: 0,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 30_000,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2024-01-01T00:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

describe('categorizeCharger', () => {
  it('classifies Tesla / Supercharger sessions by charger_type (case-insensitive)', () => {
    expect(categorizeCharger(makeSession({ charger_type: 'Tesla' }))).toBe('Supercharger');
    expect(categorizeCharger(makeSession({ charger_type: 'SUPERCHARGER V3' }))).toBe('Supercharger');
    expect(categorizeCharger(makeSession({ charger_type: 'tesla wall connector' }))).toBe('Supercharger');
  });

  it('classifies high-power non-Tesla sessions as Public DC above the 22 kW line', () => {
    expect(categorizeCharger(makeSession({ charger_type: 'CCS', peak_power_w: 150_000 }))).toBe('Public DC');
    expect(categorizeCharger(makeSession({ charger_type: 'CCS', peak_power_w: 22_001 }))).toBe('Public DC');
    // The boundary is exclusive: exactly 22 kW is NOT Public DC.
    expect(categorizeCharger(makeSession({ charger_type: 'CCS', peak_power_w: 22_000 }))).not.toBe('Public DC');
  });

  it('classifies work / office locations as Work / L2 when power is modest', () => {
    expect(categorizeCharger(makeSession({ start_place: 'The Office', peak_power_w: 7_000 }))).toBe('Work / L2');
    expect(categorizeCharger(makeSession({ start_place: 'Downtown Work Garage', peak_power_w: 11_000 }))).toBe('Work / L2');
  });

  it('defaults unmatched sessions to Home', () => {
    expect(categorizeCharger(makeSession({ start_place: 'Driveway', peak_power_w: 7_400 }))).toBe('Home');
  });

  it('is null-safe when charger_type / peak_power_w / start_place are all null', () => {
    expect(
      categorizeCharger(makeSession({ charger_type: null, peak_power_w: null, start_place: null })),
    ).toBe('Home');
  });

  it('applies precedence Supercharger > Public DC > Work/L2 > Home', () => {
    // A Supercharger type wins even with DC-level power and a work location.
    expect(
      categorizeCharger(
        makeSession({ charger_type: 'Supercharger', peak_power_w: 250_000, start_place: 'Work' }),
      ),
    ).toBe('Supercharger');
    // Public DC (power) then wins over a matching work location.
    expect(
      categorizeCharger(
        makeSession({ charger_type: 'CCS', peak_power_w: 150_000, start_place: 'Work Lot' }),
      ),
    ).toBe('Public DC');
  });
});

describe('gasEquivalentCost', () => {
  it('prices the energy-content gasoline equivalent (gallons × gas price)', () => {
    // Exactly one gallon-equivalent of energy at $3.50/gal → $3.50.
    expect(gasEquivalentCost(KWH_PER_GALLON, 30, 3.5)).toBeCloseTo(3.5, 10);
    // Two gallon-equivalents at $4.00/gal → $8.00.
    expect(gasEquivalentCost(KWH_PER_GALLON * 2, 30, 4)).toBeCloseTo(8, 10);
  });

  it('ignores mpg entirely — the result is identical for any mpg argument', () => {
    const thrifty = gasEquivalentCost(100, 15, 3.5);
    const thirsty = gasEquivalentCost(100, 55, 3.5);
    expect(thrifty).toBe(thirsty);
    expect(thrifty).toBeCloseTo((100 / KWH_PER_GALLON) * 3.5, 10);
  });

  it('never returns NaN when mpg is 0 (regression: the old 0/0 round-trip)', () => {
    const result = gasEquivalentCost(100, 0, 3.5);
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeCloseTo((100 / KWH_PER_GALLON) * 3.5, 10);
  });

  it('returns 0 for zero energy or a zero gas price', () => {
    expect(gasEquivalentCost(0, 30, 3.5)).toBe(0);
    expect(gasEquivalentCost(50, 30, 0)).toBe(0);
  });

  it('collapses non-finite energy or price to a finite 0 instead of propagating NaN', () => {
    expect(gasEquivalentCost(Number.NaN, 30, 3.5)).toBe(0);
    expect(gasEquivalentCost(100, 30, Number.NaN)).toBe(0);
    expect(gasEquivalentCost(Number.POSITIVE_INFINITY, 30, 3.5)).toBe(0);
  });
});
