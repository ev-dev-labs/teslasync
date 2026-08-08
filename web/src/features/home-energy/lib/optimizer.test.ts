import { describe, expect, it } from 'vitest';
import { optimizeHomeEnergy, DEFAULT_WEIGHTS } from './optimizer';
import type { OrchestrationInput, TariffSlot, VehicleInput } from './types';

const FLAT_TARIFF = (importPrice: number, exportPrice: number): TariffSlot => ({
  importPricePerKwh: importPrice,
  exportPricePerKwh: exportPrice,
});

function flatTariffSeries(horizon: number, importPrice = 0.2, exportPrice = 0.05): TariffSlot[] {
  return Array.from({ length: horizon }, () => FLAT_TARIFF(importPrice, exportPrice));
}

function zeros(horizon: number): number[] {
  return Array.from({ length: horizon }, () => 0);
}

function vehicle(overrides: Partial<VehicleInput> & Pick<VehicleInput, 'id'>): VehicleInput {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    currentSocPct: 0,
    targetSocPct: 100,
    usableCapacityWh: 2000,
    maxChargePowerW: 4000,
    departureSlot: null,
    priority: 'medium',
    ...overrides,
  };
}

function baseInput(overrides: Partial<OrchestrationInput> = {}): OrchestrationInput {
  const horizonSlots = overrides.horizonSlots ?? 4;
  return {
    slotMinutes: 15,
    horizonSlots,
    startTimeIso: '2024-01-01T00:00:00.000Z',
    vehicles: [],
    solarForecastW: zeros(horizonSlots),
    loadForecastW: zeros(horizonSlots),
    tariff: flatTariffSeries(horizonSlots),
    powerwall: null,
    grid: { maxImportW: 10_000, maxExportW: 10_000 },
    ...overrides,
  };
}

/** Asserts the exact per-slot energy conservation identity. */
function assertConservation(result: ReturnType<typeof optimizeHomeEnergy>) {
  for (const s of result.slots) {
    const supplied = s.solarW + s.gridImportW + s.batteryDischargeW;
    const consumed = (s.loadW - s.unmetLoadW) + s.vehicleChargeW + s.batteryChargeW + s.gridExportW + s.curtailedW;
    expect(supplied).toBeCloseTo(consumed, 6);
  }
}

describe('optimizeHomeEnergy — multiple vehicles contention', () => {
  it('resolves grid contention deterministically by priority, never fabricating readiness', () => {
    const input = baseInput({
      horizonSlots: 4,
      grid: { maxImportW: 4000, maxExportW: 4000 },
      vehicles: [
        vehicle({ id: 'high', priority: 'high', usableCapacityWh: 3000, maxChargePowerW: 3000, departureSlot: 4 }),
        vehicle({ id: 'low', priority: 'low', usableCapacityWh: 3000, maxChargePowerW: 3000, departureSlot: 4 }),
      ],
    });

    const result = optimizeHomeEnergy(input);

    const high = result.vehicles.find((v) => v.vehicleId === 'high')!;
    const low = result.vehicles.find((v) => v.vehicleId === 'low')!;

    // The high-priority vehicle must be served in full; the low-priority one
    // is starved by the shared 4000W cap and must NOT be reported as ready.
    expect(high.readinessAchieved).toBe(true);
    expect(high.unmetWh).toBeCloseTo(0, 3);
    expect(low.readinessAchieved).toBe(false);
    expect(low.unmetWh).toBeGreaterThan(0);
    expect(result.feasible).toBe(false);
    expect(result.violations.some((v) => v.vehicleId === 'low' && v.code === 'deadline_infeasible')).toBe(true);

    assertConservation(result);
  });

  it('gives every vehicle its own schedule and per-vehicle delivered energy sums to the vehicleChargeW ledger', () => {
    const input = baseInput({
      horizonSlots: 6,
      grid: { maxImportW: 8000, maxExportW: 8000 },
      vehicles: [
        vehicle({ id: 'a', priority: 'high', usableCapacityWh: 1000, maxChargePowerW: 2000, departureSlot: 6 }),
        vehicle({ id: 'b', priority: 'medium', usableCapacityWh: 1000, maxChargePowerW: 2000, departureSlot: 6 }),
        vehicle({ id: 'c', priority: 'low', usableCapacityWh: 1000, maxChargePowerW: 2000, departureSlot: 6 }),
      ],
    });

    const result = optimizeHomeEnergy(input);
    const slotHours = 0.25;
    for (const s of result.slots) {
      const sumPerVehicle = Object.values(s.vehiclePowerW).reduce((a, b) => a + b, 0);
      expect(sumPerVehicle).toBeCloseTo(s.vehicleChargeW, 6);
    }
    const totalDelivered = result.vehicles.reduce((sum, v) => sum + v.deliveredWh, 0);
    const totalFromSlots = result.slots.reduce((sum, s) => sum + s.vehicleChargeW * slotHours, 0);
    expect(totalDelivered).toBeCloseTo(totalFromSlots, 3);
  });
});

describe('optimizeHomeEnergy — solar surplus / self-consumption', () => {
  it('prefers solar-rich slots for opportunistic (non-critical) charging and avoids grid import', () => {
    const input = baseInput({
      horizonSlots: 4,
      solarForecastW: [0, 4000, 0, 4000],
      loadForecastW: [0, 0, 0, 0],
      vehicles: [vehicle({ id: 'solar-car', usableCapacityWh: 2000, maxChargePowerW: 4000, departureSlot: null })],
    });

    const result = optimizeHomeEnergy(input);
    const car = result.vehicles[0];

    expect(car.readinessAchieved).toBe(true);
    expect(car.deliveredWh).toBeCloseTo(2000, 3);
    expect(result.totals.gridImportWh).toBeCloseTo(0, 3);
    expect(result.scores.selfConsumption).toBeCloseTo(100, 0);

    const chargedSlots = car.slots.map((s) => s.slotIndex).sort();
    expect(chargedSlots).toEqual([1, 3]);

    assertConservation(result);
  });
});

describe('optimizeHomeEnergy — tariff shifting', () => {
  it('shifts non-urgent charging into cheap tariff slots over expensive ones', () => {
    const input = baseInput({
      horizonSlots: 4,
      tariff: [FLAT_TARIFF(0.3, 0.05), FLAT_TARIFF(0.05, 0.05), FLAT_TARIFF(0.3, 0.05), FLAT_TARIFF(0.05, 0.05)],
      vehicles: [vehicle({ id: 'flex-car', usableCapacityWh: 2000, maxChargePowerW: 4000, departureSlot: null })],
    });

    const result = optimizeHomeEnergy(input);
    const car = result.vehicles[0];
    const chargedSlots = car.slots.map((s) => s.slotIndex).sort();

    expect(chargedSlots).toEqual([1, 3]);
    expect(car.readinessAchieved).toBe(true);
    // Actual cost should beat the naive baseline (priced at slot 0's rate).
    expect(result.scores.cost).toBeGreaterThan(50);

    assertConservation(result);
  });
});

describe('optimizeHomeEnergy — panel/grid import cap', () => {
  it('reports unmet household load and an error violation when the panel import cap binds', () => {
    const input = baseInput({
      horizonSlots: 4,
      loadForecastW: [5000, 5000, 5000, 5000],
      grid: { maxImportW: 2000, maxExportW: 2000 },
    });

    const result = optimizeHomeEnergy(input);

    expect(result.feasible).toBe(false);
    expect(result.slots.every((s) => s.unmetLoadW > 0)).toBe(true);
    expect(result.violations.some((v) => v.code === 'panel_import_exceeded')).toBe(true);

    assertConservation(result);
  });

  it('curtails solar and reports a warning when the export cap binds', () => {
    const input = baseInput({
      horizonSlots: 2,
      solarForecastW: [6000, 6000],
      loadForecastW: [0, 0],
      grid: { maxImportW: 5000, maxExportW: 1000 },
    });

    const result = optimizeHomeEnergy(input);

    expect(result.slots.every((s) => s.curtailedW > 0)).toBe(true);
    expect(result.violations.some((v) => v.code === 'panel_export_exceeded')).toBe(true);

    assertConservation(result);
  });
});

describe('optimizeHomeEnergy — Powerwall reserve floor', () => {
  it('never discharges the battery below the configured reserve', () => {
    const input = baseInput({
      horizonSlots: 8,
      loadForecastW: Array.from({ length: 8 }, () => 3000),
      powerwall: {
        capacityWh: 4000,
        currentSocPct: 50,
        reservePct: 40,
        maxChargePowerW: 3000,
        maxDischargePowerW: 3000,
      },
      grid: { maxImportW: 1000, maxExportW: 1000 },
    });

    const result = optimizeHomeEnergy(input);

    for (const s of result.slots) {
      expect(s.batterySocPct).toBeGreaterThanOrEqual(40 - 1e-6);
    }
    // Never both charging and discharging in the same slot.
    expect(result.slots.every((s) => s.batteryChargeW <= 1e-9 || s.batteryDischargeW <= 1e-9)).toBe(true);

    assertConservation(result);
  });

  it('flags a warning when the scenario starts already below reserve', () => {
    const input = baseInput({
      horizonSlots: 2,
      powerwall: {
        capacityWh: 4000,
        currentSocPct: 20,
        reservePct: 40,
        maxChargePowerW: 3000,
        maxDischargePowerW: 3000,
      },
    });

    const result = optimizeHomeEnergy(input);
    expect(result.violations.some((v) => v.code === 'powerwall_reserve_breach')).toBe(true);
  });
});

describe('optimizeHomeEnergy — infeasible deadline', () => {
  it('reports the exact unmet energy instead of fabricating readiness', () => {
    const input = baseInput({
      horizonSlots: 4,
      vehicles: [
        vehicle({
          id: 'rushed',
          currentSocPct: 0,
          targetSocPct: 100,
          usableCapacityWh: 40_000, // huge pack
          maxChargePowerW: 3000, // slow charger
          departureSlot: 2, // only 30 minutes available
        }),
      ],
      grid: { maxImportW: 20_000, maxExportW: 20_000 },
    });

    const result = optimizeHomeEnergy(input);
    const rushed = result.vehicles[0];

    expect(result.feasible).toBe(false);
    expect(rushed.readinessAchieved).toBe(false);
    expect(rushed.unmetWh).toBeCloseTo(rushed.neededWh - rushed.deliveredWh, 3);
    expect(rushed.unmetWh).toBeGreaterThan(0);
    expect(rushed.finalSocPct).toBeLessThan(rushed.targetSocPct);
    expect(result.violations.some((v) => v.code === 'deadline_infeasible' && v.vehicleId === 'rushed')).toBe(true);
  });
});

describe('optimizeHomeEnergy — energy conservation', () => {
  it('holds the exact conservation identity every slot in a complex mixed scenario', () => {
    const horizonSlots = 12;
    const input = baseInput({
      horizonSlots,
      solarForecastW: [0, 1000, 3000, 5000, 6000, 5000, 3000, 1000, 0, 0, 0, 0],
      loadForecastW: [2000, 2000, 2500, 2500, 2000, 2000, 2500, 3000, 3500, 3000, 2500, 2000],
      tariff: flatTariffSeries(horizonSlots, 0.25, 0.08),
      powerwall: {
        capacityWh: 10_000,
        currentSocPct: 60,
        reservePct: 20,
        maxChargePowerW: 4000,
        maxDischargePowerW: 4000,
      },
      grid: { maxImportW: 6000, maxExportW: 4000 },
      vehicles: [
        vehicle({ id: 'a', priority: 'high', usableCapacityWh: 60_000, maxChargePowerW: 7000, departureSlot: 10 }),
        vehicle({ id: 'b', priority: 'low', usableCapacityWh: 40_000, maxChargePowerW: 5000, departureSlot: null, currentSocPct: 40, targetSocPct: 80 }),
      ],
    });

    const result = optimizeHomeEnergy(input);
    assertConservation(result);
    expect(result.slots).toHaveLength(horizonSlots);
  });
});

describe('optimizeHomeEnergy — determinism', () => {
  it('produces a deep-equal result across repeated runs and never mutates its input', () => {
    const input = baseInput({
      horizonSlots: 8,
      solarForecastW: [0, 500, 2000, 4000, 4000, 2000, 500, 0],
      loadForecastW: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500],
      powerwall: {
        capacityWh: 6000,
        currentSocPct: 50,
        reservePct: 20,
        maxChargePowerW: 3000,
        maxDischargePowerW: 3000,
      },
      vehicles: [
        vehicle({ id: 'x', priority: 'high', departureSlot: 6 }),
        vehicle({ id: 'y', priority: 'medium', departureSlot: null }),
      ],
      previousPlan: { x: [1, 2], y: [4, 5] },
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = optimizeHomeEnergy(input);
    const second = optimizeHomeEnergy(input);
    const third = optimizeHomeEnergy(JSON.parse(JSON.stringify(input)));

    expect(first).toEqual(second);
    expect(first).toEqual(third);
    expect(input).toEqual(snapshot);
  });
});

describe('optimizeHomeEnergy — bad / malformed input', () => {
  it('never throws and always returns a well-formed result for a wide range of malformed inputs', () => {
    const malformed: unknown[] = [
      undefined,
      null,
      {},
      { horizonSlots: -5 },
      { horizonSlots: NaN },
      baseInput({ horizonSlots: 0 }),
      { ...baseInput(), slotMinutes: -15 },
      { ...baseInput(), vehicles: [{ id: '' }] },
      { ...baseInput(), vehicles: [{ id: 'no-capacity', usableCapacityWh: 0, maxChargePowerW: 3000 }] },
      { ...baseInput(), vehicles: [{ id: 'nan-soc', currentSocPct: NaN, targetSocPct: NaN, usableCapacityWh: 1000, maxChargePowerW: 1000 }] },
      { ...baseInput({ horizonSlots: 4 }), solarForecastW: [1, 2] }, // forecast shorter than horizon
      { ...baseInput({ horizonSlots: 3 }), loadForecastW: [1, 2, 3, 4, 5, 6] }, // forecast longer than horizon
      { ...baseInput(), grid: { maxImportW: -1, maxExportW: NaN } },
      { ...baseInput(), powerwall: { capacityWh: -1, currentSocPct: 50, reservePct: 20, maxChargePowerW: 100, maxDischargePowerW: 100 } },
      { ...baseInput(), tariff: [] },
    ];

    for (const bad of malformed) {
      expect(() => optimizeHomeEnergy(bad as OrchestrationInput)).not.toThrow();
      const result = optimizeHomeEnergy(bad as OrchestrationInput);
      expect(typeof result.feasible).toBe('boolean');
      expect(Array.isArray(result.slots)).toBe(true);
      expect(Array.isArray(result.vehicles)).toBe(true);
      expect(Array.isArray(result.violations)).toBe(true);
      expect(result.scores).toBeTruthy();
    }
  });

  it('drops vehicles with invalid ids/capacities and reports the drop count', () => {
    const input = baseInput({
      horizonSlots: 2,
      vehicles: [
        { id: '', name: 'bad', currentSocPct: 0, targetSocPct: 100, usableCapacityWh: 1000, maxChargePowerW: 1000, departureSlot: null, priority: 'medium' },
        vehicle({ id: 'ok', usableCapacityWh: 1000, maxChargePowerW: 1000 }),
      ],
    });

    const result = optimizeHomeEnergy(input);
    expect(result.meta.droppedVehicleCount).toBe(1);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0].vehicleId).toBe('ok');
  });

  it('clamps out-of-range SoC percentages instead of producing NaN output', () => {
    const input = baseInput({
      horizonSlots: 2,
      vehicles: [vehicle({ id: 'clamp', currentSocPct: -50, targetSocPct: 500 })],
    });

    const result = optimizeHomeEnergy(input);
    const v = result.vehicles[0];
    expect(Number.isNaN(v.neededWh)).toBe(false);
    expect(v.startingSocPct).toBe(0);
    expect(v.targetSocPct).toBe(100);
  });
});

describe('DEFAULT_WEIGHTS', () => {
  it('sums to a positive total so overall score is always well-defined', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
  });
});
