import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ChargingSession } from '@/api/types';
import { FUEL } from '@/lib/constants';
import {
  CO2_PER_GAL_KG,
  DEFAULT_ELECTRICITY_RATE,
  DEFAULT_GAS_PRICE,
  DEFAULT_MPG,
  KG_CO2_PER_TREE_YEAR,
  KWH_PER_GALLON,
} from './constants';
import { useCostAnalysisData } from './useCostAnalysisData';

/**
 * `constants.ts` is a pure module of reference figures that drive every number
 * on the Cost Analysis page. A wrong sign, a fat-fingered digit, or drift from
 * the shared `FUEL` block would silently corrupt savings / CO2 / tree math with
 * no type error to catch it — so these tests pin the physical meaning of each
 * value, the derived quantities they produce, and their wiring into the real
 * `useCostAnalysisData` consumer (rather than asserting the literals back).
 */

const ALL_CONSTANTS = {
  DEFAULT_GAS_PRICE,
  DEFAULT_MPG,
  DEFAULT_ELECTRICITY_RATE,
  CO2_PER_GAL_KG,
  KG_CO2_PER_TREE_YEAR,
  KWH_PER_GALLON,
} as const;

const METERS_PER_MILE = 1609.344;

/** Minimal-but-valid ChargingSession; overrides tweak the fields under test. */
function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const base: ChargingSession = {
    id: 1,
    vehicle_id: 1,
    started_at: '2025-01-15T10:00:00Z',
    ended_at: '2025-01-15T10:30:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 0,
    end_odometer_m: METERS_PER_MILE * 10, // 10 miles added
    start_lat: 37.4,
    start_lng: -122.1,
    start_place: 'Home',
    total_energy_added_wh: 50_000, // 50 kWh
    peak_power_w: 11_000,
    avg_power_w: 10_000,
    cost_decimal: 5,
    cost_currency: 'USD',
    charger_type: 'Tesla',
    cable_type: 'NACS',
    startedAt: '2025-01-15T10:00:00Z',
    duration_min: 30,
  };
  return { ...base, ...overrides };
}

describe('cost-analysis constants — physical invariants', () => {
  it('exposes a finite, strictly positive magnitude for every constant', () => {
    const entries = Object.entries(ALL_CONSTANTS);
    expect(entries).toHaveLength(6);
    for (const [name, value] of entries) {
      expect(Number.isFinite(value), `${name} must be finite`).toBe(true);
      expect(value, `${name} must be positive`).toBeGreaterThan(0);
    }
  });

  it('models a fractional electricity price and whole-number counts', () => {
    // A residential $/kWh rate is always well below $1.
    expect(DEFAULT_ELECTRICITY_RATE).toBeGreaterThan(0);
    expect(DEFAULT_ELECTRICITY_RATE).toBeLessThan(1);
    // Efficiency and tree counts are whole-number reference figures.
    expect(Number.isInteger(DEFAULT_MPG)).toBe(true);
    expect(Number.isInteger(KG_CO2_PER_TREE_YEAR)).toBe(true);
    // A pump price should sit in a plausible USD/gal band.
    expect(DEFAULT_GAS_PRICE).toBeGreaterThan(0);
    expect(DEFAULT_GAS_PRICE).toBeLessThan(20);
  });

  it('pins KWH_PER_GALLON to the EPA MPGe energy equivalence (33.7 kWh/gal)', () => {
    expect(KWH_PER_GALLON).toBeGreaterThan(30);
    expect(KWH_PER_GALLON).toBeLessThan(40);
    // 337 kWh of stored energy is worth exactly ten gallons of gasoline.
    expect(337 / KWH_PER_GALLON).toBeCloseTo(10, 6);
  });

  it('pins CO2_PER_GAL_KG to the EPA tailpipe factor for gasoline', () => {
    expect(CO2_PER_GAL_KG).toBeGreaterThan(8);
    expect(CO2_PER_GAL_KG).toBeLessThan(10);
    // Burning ten gallons releases ~88.87 kg of CO2.
    expect(10 * CO2_PER_GAL_KG).toBeCloseTo(88.87, 6);
  });
});

describe('cost-analysis constants — derived-quantity behaviour', () => {
  it('derives the carbon intensity of gasoline per kWh-equivalent', () => {
    const kgCo2PerKwh = CO2_PER_GAL_KG / KWH_PER_GALLON;
    // Gasoline carries ~0.26 kg CO2 per kWh of chemical energy.
    expect(kgCo2PerKwh).toBeGreaterThan(0.2);
    expect(kgCo2PerKwh).toBeLessThan(0.3);
    expect(kgCo2PerKwh).toBeCloseTo(0.2637, 3);
  });

  it('converts avoided emissions into an equivalent number of trees', () => {
    // 88 kg of avoided CO2 ≈ four mature trees for a year.
    expect(88 / KG_CO2_PER_TREE_YEAR).toBeCloseTo(4, 6);
    // Two trees sequester exactly 44 kg across a full year.
    expect(2 * KG_CO2_PER_TREE_YEAR).toBe(44);
  });

  it('prices the energy-equivalent gasoline for an EV charge using the defaults', () => {
    const chargeKwh = 100;
    const gallonsEquiv = chargeKwh / KWH_PER_GALLON;
    const energyEquivGasCost = gallonsEquiv * DEFAULT_GAS_PRICE;
    const rawElectricityCost = chargeKwh * DEFAULT_ELECTRICITY_RATE;

    expect(gallonsEquiv).toBeCloseTo(2.9674, 3);
    expect(energyEquivGasCost).toBeCloseTo(10.3858, 3);
    expect(rawElectricityCost).toBeCloseTo(13, 6);
    // Energy parity understates ICE running cost (it ignores drivetrain
    // losses), so the naive gasoline figure lands below the raw kWh cost.
    expect(energyEquivGasCost).toBeLessThan(rawElectricityCost);
  });
});

describe('cost-analysis constants — single source of truth', () => {
  it('does not drift from the shared FUEL constants in @/lib/constants', () => {
    expect(CO2_PER_GAL_KG).toBe(FUEL.CO2_PER_GALLON_KG);
    expect(KG_CO2_PER_TREE_YEAR).toBe(FUEL.KG_CO2_PER_TREE_YEAR);
    expect(DEFAULT_GAS_PRICE).toBe(FUEL.DEFAULT_GAS_PRICE_USD);
    expect(DEFAULT_MPG).toBe(FUEL.DEFAULT_MPG);
  });
});

describe('cost-analysis constants — wired through useCostAnalysisData', () => {
  const toKm = (meters: number) => meters / 1000;

  it('drives CO2, tree, gallon and cost savings from real charging sessions', () => {
    const sessions = [
      makeSession({ id: 1, total_energy_added_wh: 50_000, cost_decimal: 5 }),
      makeSession({
        id: 2,
        total_energy_added_wh: 50_000,
        cost_decimal: 5,
        start_odometer_m: 100_000,
        end_odometer_m: 100_000 + METERS_PER_MILE * 10,
      }),
    ];

    const { result } = renderHook(() =>
      useCostAnalysisData({
        sessions,
        gasPrice: DEFAULT_GAS_PRICE,
        mpg: DEFAULT_MPG,
        electricityRate: DEFAULT_ELECTRICITY_RATE,
        toDistanceDisplay: toKm,
      }),
    );

    const cs = result.current.coreStats;
    if (!cs) throw new Error('expected coreStats for a non-empty session set');

    expect(cs.count).toBe(2);
    expect(cs.totalEnergy).toBeCloseTo(100, 6); // 2 × 50 kWh

    // The three environmental figures must be produced by the constants,
    // not by any hard-coded number inside the hook.
    expect(cs.gallonsEquiv).toBeCloseTo(cs.totalEnergy / KWH_PER_GALLON, 6);
    expect(cs.co2SavedKg).toBeCloseTo(cs.gallonsEquiv * CO2_PER_GAL_KG, 6);
    expect(cs.treeEquiv).toBeCloseTo(cs.co2SavedKg / KG_CO2_PER_TREE_YEAR, 6);
    expect(cs.treeEquiv).toBeCloseTo(1.1987, 3); // concrete end-to-end value

    // DEFAULT_MPG + DEFAULT_GAS_PRICE flow into the distance-based comparison,
    // DEFAULT_ELECTRICITY_RATE into the raw EV cost. 20 miles @ 30 mpg.
    const gc = result.current.gasComparison;
    if (!gc) throw new Error('expected gasComparison for a non-empty session set');
    expect(gc.gasCost).toBeCloseTo((20 / DEFAULT_MPG) * DEFAULT_GAS_PRICE, 4);
    expect(gc.evCost).toBeCloseTo(cs.totalEnergy * DEFAULT_ELECTRICITY_RATE, 6);
    expect(gc.evCost).toBeCloseTo(13, 6);
  });

  it('returns null core stats for empty and undefined session inputs', () => {
    const empty = renderHook(() =>
      useCostAnalysisData({
        sessions: [],
        gasPrice: DEFAULT_GAS_PRICE,
        mpg: DEFAULT_MPG,
        electricityRate: DEFAULT_ELECTRICITY_RATE,
        toDistanceDisplay: toKm,
      }),
    );
    expect(empty.result.current.coreStats).toBeNull();
    expect(empty.result.current.gasComparison).toBeNull();
    expect(empty.result.current.monthlyData).toEqual([]);

    const missing = renderHook(() =>
      useCostAnalysisData({
        sessions: undefined,
        gasPrice: DEFAULT_GAS_PRICE,
        mpg: DEFAULT_MPG,
        electricityRate: DEFAULT_ELECTRICITY_RATE,
        toDistanceDisplay: toKm,
      }),
    );
    expect(missing.result.current.coreStats).toBeNull();
    expect(missing.result.current.lifetimeMetrics).toBeNull();
  });
});
