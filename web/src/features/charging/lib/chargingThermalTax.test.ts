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
    const summary = analyzeChargingThermalTax(samples);
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

  it('ignores samples with an unparsable timestamp', () => {
    const samples = [
      sample(0, { battery_heater_power_w: 1000 }),
      { ...sample(600, { battery_heater_power_w: 1000 }), ts: 'not-a-date' },
      sample(1200, { battery_heater_power_w: 1000 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.sampleCount).toBe(2);
  });

  it('treats negative/garbage heater readings as zero rather than subtracting energy', () => {
    const samples = [
      sample(0, { battery_heater_power_w: -500 }),
      sample(600, { battery_heater_power_w: -500 }),
    ];
    const summary = analyzeChargingThermalTax(samples);
    expect(summary.heaterWh).toBe(0);
  });
});
