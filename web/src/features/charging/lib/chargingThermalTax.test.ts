import { describe, it, expect } from 'vitest';
import { analyzeChargingThermalTax, type ThermalTaxSample } from './chargingThermalTax';

const T0 = Date.UTC(2026, 0, 1, 8, 0, 0);

function sample(
  offsetS: number,
  overrides: Partial<ThermalTaxSample> = {},
): ThermalTaxSample {
  return {
    ts: new Date(T0 + offsetS * 1000).toISOString(),
    battery_heater_power_w: null,
    ac_charging_power_w: null,
    dc_charging_power_w: null,
    ac_charging_energy_in_wh: null,
    dc_charging_energy_in_wh: null,
    ...overrides,
  };
}

describe('analyzeChargingThermalTax', () => {
  it('is empty and safe with no samples', () => {
    const s = analyzeChargingThermalTax([]);
    expect(s.sampleCount).toBe(0);
    expect(s.heaterWh).toBe(0);
    expect(s.deliveredEnergyWh).toBeNull();
    expect(s.energySource).toBe('none');
    expect(s.phases).toEqual([]);
  });

  it('integrates a constant heater power over time to the expected Wh', () => {
    // 2000W for exactly 1800s (0.5h) → 1000 Wh.
    const samples = [
      sample(0, { battery_heater_power_w: 2000, ac_charging_energy_in_wh: 0 }),
      sample(1800, { battery_heater_power_w: 2000, ac_charging_energy_in_wh: 5000 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.heaterWh).toBe(1000);
  });

  it('prefers cumulative energy fields when present and monotonic', () => {
    const samples = [
      sample(0, { ac_charging_energy_in_wh: 100, dc_charging_energy_in_wh: 0 }),
      sample(600, { ac_charging_energy_in_wh: 600, dc_charging_energy_in_wh: 0 }),
      sample(1200, { ac_charging_energy_in_wh: 1100, dc_charging_energy_in_wh: 0 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.energySource).toBe('cumulative');
    expect(summary.deliveredEnergyWh).toBe(1000);
  });

  it('falls back to the power integral when cumulative energy is entirely absent', () => {
    const samples = [
      sample(0, { ac_charging_power_w: 7000 }),
      sample(1800, { ac_charging_power_w: 7000 }), // 0.5h @ 7000W = 3500 Wh
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.energySource).toBe('power_integral');
    expect(summary.deliveredEnergyWh).toBe(3500);
  });

  it('falls back to the power integral when the cumulative series resets mid-session', () => {
    const samples = [
      sample(0, { ac_charging_energy_in_wh: 4000, ac_charging_power_w: 7000 }),
      sample(600, { ac_charging_energy_in_wh: 4500, ac_charging_power_w: 7000 }),
      // Reset back to near-zero — e.g. a new session boundary bled into the query.
      sample(1200, { ac_charging_energy_in_wh: 50, ac_charging_power_w: 7000 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.energySource).toBe('power_integral');
    expect(summary.deliveredEnergyWh).toBeGreaterThan(0);
  });

  it('reports energySource "none" when neither cumulative nor power fields are usable', () => {
    const samples = [sample(0), sample(600), sample(1200)];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.energySource).toBe('none');
    expect(summary.deliveredEnergyWh).toBeNull();
    expect(summary.heaterSharePct).toBeNull();
  });

  it('computes heater share as a percentage of delivered energy', () => {
    const samples = [
      sample(0, { battery_heater_power_w: 1000, ac_charging_energy_in_wh: 0 }),
      sample(3600, { battery_heater_power_w: 1000, ac_charging_energy_in_wh: 10_000 }), // 1h @1000W = 1000Wh heater
    ];
    const summary = analyzeChargingThermalTax(samples, { maxGapS: 3600 });
    expect(summary.heaterWh).toBe(1000);
    expect(summary.deliveredEnergyWh).toBe(10_000);
    expect(summary.heaterSharePct).toBeCloseTo(10, 5);
  });

  it('reports peak heater power and heater-on time above the noise threshold', () => {
    const samples = [
      sample(0, { battery_heater_power_w: 0 }), // off
      sample(300, { battery_heater_power_w: 0 }), // still off
      sample(600, { battery_heater_power_w: 3000 }), // on
      sample(900, { battery_heater_power_w: 3000 }), // still on
      sample(1200, { battery_heater_power_w: 0 }), // back off
      sample(1500, { battery_heater_power_w: 0 }), // still off
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.peakHeaterW).toBe(3000);
    expect(summary.heaterOnS).toBeGreaterThan(0);
    expect(summary.heaterOnS).toBeLessThan(summary.spanS);
  });

  it('splits the session into contiguous heater on/off phases', () => {
    const samples = [
      sample(0, { battery_heater_power_w: 0 }),
      sample(300, { battery_heater_power_w: 3000 }),
      sample(600, { battery_heater_power_w: 3000 }),
      sample(900, { battery_heater_power_w: 0 }),
      sample(1200, { battery_heater_power_w: 0 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    const states = summary.phases.map((p) => p.state);
    expect(states).toEqual(['heater_off', 'heater_on', 'heater_off']);
  });

  it('reports full data coverage for evenly spaced samples and partial coverage across a large gap', () => {
    const dense = [sample(0), sample(60), sample(120), sample(180)];
    const denseSummary = analyzeChargingThermalTax(dense, { maxGapS: 300 });
    expect(denseSummary.dataCoveragePct).toBe(100);

    const gappy = [sample(0), sample(60), sample(6000)]; // a ~99-minute gap
    const gappySummary = analyzeChargingThermalTax(gappy, { maxGapS: 300 });
    expect(gappySummary.dataCoveragePct).toBeLessThan(50);
  });

  it('brackets sparse phase transitions without changing observations or the independent KPIs', () => {
    const rows = [
      sample(1200, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 1200 }),
      sample(0, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 0 }),
      sample(900, { battery_heater_power_w: 3000, ac_charging_energy_in_wh: 900 }),
      sample(300, { battery_heater_power_w: 3000, ac_charging_energy_in_wh: 300 }),
    ];
    const before = structuredClone(rows);
    const s = analyzeChargingThermalTax(rows);
    const entering = { earliestMs: T0, latestMs: T0 + 300_000 };
    const leaving = { earliestMs: T0 + 900_000, latestMs: T0 + 1200_000 };
    expect(s.phases).toEqual([
      { startMs: T0, endMs: T0, durationS: 0, state: 'heater_off', avgHeaterW: 0,
        startTransition: null, endTransition: entering },
      { startMs: T0 + 300_000, endMs: T0 + 900_000, durationS: 600,
        state: 'heater_on', avgHeaterW: 3000, startTransition: entering, endTransition: leaving },
      { startMs: T0 + 1200_000, endMs: T0 + 1200_000, durationS: 0,
        state: 'heater_off', avgHeaterW: 0, startTransition: leaving, endTransition: null },
    ]);
    expect(s.heaterOnS).toBe(1200);
    expect(s.heaterOnPct).toBe(100);
    expect(s.heaterWh).toBe(750);
    expect(s.deliveredEnergyWh).toBe(1200);
    expect(s.heaterSharePct).toBeCloseTo(125 / 3);
    expect(rows).toEqual(before);
  });

  it('uses the current threshold and brackets across missing heater observations', () => {
    const s = analyzeChargingThermalTax([
      sample(0, { battery_heater_power_w: 50 }),
      sample(60),
      sample(120, { battery_heater_power_w: 50.5 }),
    ]);
    expect(s.phases.map(p => p.state)).toEqual(['heater_off', 'heater_on']);
    expect(s.phases[0]!.endTransition).toEqual({ earliestMs: T0, latestMs: T0 + 120_000 });
    expect(s.phases[1]!.startTransition).toEqual(s.phases[0]!.endTransition);
    expect(s.heaterOnS).toBe(0);
    const custom = analyzeChargingThermalTax([
      sample(0, { battery_heater_power_w: 50 }),
      sample(120, { battery_heater_power_w: 50.5 }),
    ], { heaterOnThresholdW: 50.5 });
    expect(custom.phases).toEqual([{
      startMs: T0, endMs: T0 + 120_000, durationS: 120,
      state: 'heater_off', avgHeaterW: 50.25, startTransition: null, endTransition: null,
    }]);
  });

  it('ignores samples with an unparsable timestamp', () => {
    const samples = [
      sample(0, { battery_heater_power_w: 1000 }),
      { ...sample(600, { battery_heater_power_w: 1000 }), ts: 'not-a-date' },
      sample(1200, { battery_heater_power_w: 1000 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.sampleCount).toBe(2);
  });

  it('preserves valid signed heater readings', () => {
    const samples = [
      sample(0, { battery_heater_power_w: -500 }),
      sample(600, { battery_heater_power_w: -500 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.heaterWh).toBeCloseTo(-500 / 6);
    expect(summary.peakHeaterW).toBe(-500);
  });

  it.each(['first', 'last'] as const)('matches only the counter window with the %s counter absent', (missing) => {
    const rows = [0, 60, 120].map((offset, i) => sample(offset, {
      battery_heater_power_w: i === 1 ? 60 : 180,
      ac_charging_energy_in_wh: i * 100,
    }));
    rows[missing === 'first' ? 0 : 2]!.ac_charging_energy_in_wh = null;
    const s = analyzeChargingThermalTax(rows);
    expect(s.heaterWh).toBe(4);
    expect(s.deliveredEnergyWh).toBe(100);
    expect(s.matchedHeaterWh).toBe(2);
    expect(s.matchedDeliveredEnergyWh).toBe(100);
    expect(s.heaterSharePct).toBe(2);
    expect(s.matchedCoveragePct).toBe(50);
    expect(s.sourceCoveragePct).toBe(50);
    expect(s.sourceIntervals).toEqual([{
      startMs: T0 + (missing === 'first' ? 60_000 : 0),
      endMs: T0 + (missing === 'first' ? 120_000 : 60_000),
      heaterWh: 2,
      deliveredEnergyWh: 100,
    }]);
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('does not treat invalid heater %s as measured zero', (value) => {
    const rows = [
      sample(0, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 0 }),
      sample(60, { ac_charging_energy_in_wh: 100 }),
      sample(120, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 200 }),
    ];
    Object.assign(rows[1]!, { battery_heater_power_w: value });
    const s = analyzeChargingThermalTax(rows);
    expect(s.heaterSharePct).toBeNull();
    expect(s.matchedHeaterWh).toBeNull();
    expect(s.matchedDeliveredEnergyWh).toBeNull();
    expect(s.matchedCoveragePct).toBe(0);
    expect(s.sourceIntervals.every((p) => p.heaterWh === null)).toBe(true);
  });

  it('reports measured zero heater share with fully observed readings', () => {
    const s = analyzeChargingThermalTax([
      sample(0, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 0 }),
      sample(60, { battery_heater_power_w: 0, ac_charging_energy_in_wh: 100 }),
    ]);
    expect(s.heaterSharePct).toBe(0);
    expect(s.matchedHeaterWh).toBe(0);
    expect(s.matchedCoveragePct).toBe(100);
  });

  it.each(['cumulative', 'power_integral'] as const)('preserves measured zero delivered energy from %s', (method) => {
    const s = analyzeChargingThermalTax([0, 60].map((offset) => sample(offset, {
      battery_heater_power_w: 10,
      ...(method === 'cumulative'
        ? { ac_charging_energy_in_wh: 123, ac_charging_power_w: 1000 }
        : { ac_charging_power_w: 0 }),
    })));
    expect(s.energySource).toBe(method);
    expect(s.deliveredEnergyWh).toBe(0);
    expect(s.matchedDeliveredEnergyWh).toBe(0);
    expect(s.heaterSharePct).toBeNull();
  });

  it('preserves fractional signed values and does not mutate or reorder raw samples', () => {
    const rows = [
      sample(60, { battery_heater_power_w: -0.75, ac_charging_power_w: 15.5 }),
      sample(0, { battery_heater_power_w: -0.75, ac_charging_power_w: 15.5 }),
    ];
    const before = structuredClone(rows);
    const s = analyzeChargingThermalTax(rows);
    expect(s.heaterWh).toBeCloseTo(-0.0125);
    expect(s.deliveredEnergyWh).toBeCloseTo(15.5 / 60);
    expect(s.heaterSharePct).toBeCloseTo(-0.75 / 15.5 * 100);
    expect(s.phases[0]!.avgHeaterW).toBe(-0.75);
    expect(rows).toEqual(before);
  });

  it('retains signed charging power without calling it missing', () => {
    const s = analyzeChargingThermalTax([0, 60].map((offset) => sample(offset, {
      battery_heater_power_w: 0.5, dc_charging_power_w: -15.5,
    })));
    expect(s.energySource).toBe('power_integral');
    expect(s.deliveredEnergyWh).toBeCloseTo(-15.5 / 60);
    expect(s.heaterSharePct).toBeNull();
  });

  it('exposes unmatched source energy across a heater coverage gap', () => {
    const s = analyzeChargingThermalTax([0, 600].map((offset) => sample(offset, {
      battery_heater_power_w: 60, ac_charging_energy_in_wh: offset,
    })));
    expect(s.heaterWh).toBe(10);
    expect(s.deliveredEnergyWh).toBe(600);
    expect(s.sourceIntervals[0]!.heaterWh).toBeNull();
    expect(s.sourceCoveragePct).toBe(100);
    expect(s.matchedCoveragePct).toBe(0);
    expect(s.heaterSharePct).toBeNull();
  });

  it('matches a sparse cumulative interval using dense heater samples', () => {
    const s = analyzeChargingThermalTax([0, 60, 120].map((offset) => sample(offset, {
      battery_heater_power_w: 60,
      ac_charging_energy_in_wh: offset === 60 ? null : offset,
    })));
    expect(s.matchedHeaterWh).toBe(2);
    expect(s.matchedDeliveredEnergyWh).toBe(120);
    expect(s.matchedCoveragePct).toBe(100);
  });

  it('does not infer a total by switching between AC and DC counters', () => {
    const s = analyzeChargingThermalTax([
      sample(0, { ac_charging_energy_in_wh: 100 }),
      sample(60, { dc_charging_energy_in_wh: 200 }),
    ]);
    expect(s.energySource).toBe('none');
    expect(s.deliveredEnergyWh).toBeNull();
    expect(s.heaterSharePct).toBeNull();
  });

  it.each([null, NaN, Infinity])('reports invalid delivered input %s as unknown, not zero', (value) => {
    const s = analyzeChargingThermalTax([0, 60].map((offset) => sample(offset, {
      battery_heater_power_w: 0,
      ac_charging_energy_in_wh: value,
      ac_charging_power_w: value,
    })));
    expect(s.deliveredEnergyWh).toBeNull();
    expect(s.energySource).toBe('none');
    expect(s.sourceIntervals).toEqual([]);
  });

  it('cannot establish energy scope from only duplicate timestamps', () => {
    const s = analyzeChargingThermalTax([
      sample(0, { battery_heater_power_w: 60, ac_charging_energy_in_wh: 0, ac_charging_power_w: 60 }),
      sample(0, { battery_heater_power_w: 60, ac_charging_energy_in_wh: 100, ac_charging_power_w: 60 }),
    ]);
    expect(s.deliveredEnergyWh).toBeNull();
    expect(s.heaterSharePct).toBeNull();
  });

  it('compares only matched intervals when heater coverage is partial', () => {
    const s = analyzeChargingThermalTax([0, 60, 120, 180].map((offset) => sample(offset, {
      battery_heater_power_w: offset === 180 ? null : 60,
      ac_charging_energy_in_wh: offset,
    })));
    expect(s.deliveredEnergyWh).toBe(180);
    expect(s.matchedDeliveredEnergyWh).toBe(120);
    expect(s.matchedHeaterWh).toBe(2);
    expect(s.heaterSharePct).toBeCloseTo(100 / 60);
    expect(s.sourceCoveragePct).toBe(100);
    expect(s.matchedCoveragePct).toBeCloseTo(200 / 3);
  });

  it('matches a partial fallback power window rather than the whole heater span', () => {
    const s = analyzeChargingThermalTax([0, 60, 120].map((offset) => sample(offset, {
      battery_heater_power_w: offset === 0 ? 600 : 60,
      ac_charging_power_w: offset === 0 ? null : 600,
    })));
    expect(s.energySource).toBe('power_integral');
    expect(s.heaterWh).toBe(6.5);
    expect(s.deliveredEnergyWh).toBe(10);
    expect(s.matchedHeaterWh).toBe(1);
    expect(s.heaterSharePct).toBe(10);
    expect(s.matchedCoveragePct).toBe(50);
  });

  it('preserves fractional cumulative differences including signed counter baselines', () => {
    const s = analyzeChargingThermalTax([
      sample(0, { battery_heater_power_w: 0.75, ac_charging_energy_in_wh: -0.25 }),
      sample(60, { battery_heater_power_w: 0.75, ac_charging_energy_in_wh: 0.125 }),
    ]);
    expect(s.deliveredEnergyWh).toBe(0.375);
    expect(s.heaterWh).toBe(0.0125);
    expect(s.heaterSharePct).toBeCloseTo(10 / 3);
  });
});
