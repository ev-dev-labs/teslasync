import { describe, expect, it } from 'vitest';

import { analyzeTrueCost } from './trueCost';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_id: 7,
    total_charging_cost: 100,
    total_wh: 100_000,
    total_sessions: 8,
    total_km: 1_000,
    first_date: '2025-01-01',
    last_date: '2025-10-01',
    months_of_ownership: 10,
    cost_per_km_ev: 0.1,
    cost_per_km_ice: 0.3,
    equivalent_gas_cost: 300,
    total_savings: 200,
    monthly_savings: 20,
    maintenance_savings_estimate: 500,
    gas_price: 4,
    gas_efficiency_mpg: 30,
    base_cost_per_kwh: 0.15,
    monthly_breakdown: [
      {
        month: '2025-01',
        ev_cost: 40,
        equiv_gas_cost: 120,
        savings: 80,
        cumulative_savings: 80,
        energy_wh: 40_000,
      },
      {
        month: '2025-03',
        ev_cost: 60,
        equiv_gas_cost: 180,
        savings: 120,
        cumulative_savings: 200,
        energy_wh: 60_000,
      },
    ],
    ...overrides,
  };
}

describe('analyzeTrueCost top-level validation', () => {
  it('distinguishes missing, malformed, zero, and signed values', () => {
    const result = analyzeTrueCost({
      vehicle_id: '7',
      total_charging_cost: 0,
      total_wh: null,
      total_sessions: -1,
      total_km: Number.NaN,
      total_savings: -25,
      monthly_breakdown: [],
    });

    expect(result.metrics.vehicleId).toEqual({
      value: null,
      availability: 'invalid',
    });
    expect(result.metrics.totalChargingCost).toEqual({
      value: 0,
      availability: 'valid',
    });
    expect(result.metrics.totalWh).toEqual({
      value: null,
      availability: 'missing',
    });
    expect(result.metrics.totalSessions.availability).toBe('invalid');
    expect(result.metrics.totalKm.availability).toBe('invalid');
    expect(result.metrics.totalFuelDelta.value).toBe(-25);
    expect(result.metrics.monthlyFuelDelta.availability).toBe('missing');
  });

  it('classifies absent and non-object payloads without fabricating zeros', () => {
    expect(analyzeTrueCost(undefined).payloadAvailability).toBe('missing');
    const invalid = analyzeTrueCost(['not', 'an', 'object']);
    expect(invalid.payloadAvailability).toBe('invalid');
    expect(invalid.metrics.totalChargingCost.value).toBeNull();
    expect(invalid.zeroEnvelope).toBe(false);
  });

  it('rejects impossible calendar dates and reversed drive ranges', () => {
    const result = analyzeTrueCost(payload({
      first_date: '2025-02-30',
      last_date: '2025-01-01',
    }));

    expect(result.metrics.firstDate.availability).toBe('invalid');
    expect(result.driveSpan.available).toBe(false);
    expect(result.gates.maintenanceHeuristic).toBe(false);
  });
});

describe('analyzeTrueCost monthly evidence', () => {
  it('assigns one terminal disposition, keeps first duplicate, and sorts eligible months', () => {
    const result = analyzeTrueCost(payload({
      monthly_breakdown: [
        {
          month: '2025-03',
          ev_cost: 3,
          equiv_gas_cost: 8,
          savings: 5,
          cumulative_savings: 5,
          energy_wh: 30,
        },
        null,
        { month: 'March', ev_cost: 1 },
        {
          month: '2025-01',
          ev_cost: 2,
          equiv_gas_cost: 7,
          savings: 5,
          cumulative_savings: 5,
          energy_wh: 20,
        },
        {
          month: '2025-03',
          ev_cost: 99,
          equiv_gas_cost: 100,
          savings: 1,
          cumulative_savings: 6,
          energy_wh: 99,
        },
      ],
    }));

    expect(result.monthlyAccounting).toMatchObject({
      returnedRows: 5,
      invalidRowRows: 1,
      invalidMonthRows: 1,
      duplicateMonthRows: 1,
      eligibleRows: 2,
    });
    expect(result.monthly.map((row) => row.disposition)).toEqual([
      'eligible',
      'invalid_row',
      'invalid_month',
      'eligible',
      'duplicate_month',
    ]);
    expect(result.eligibleMonthly.map((row) => row.month)).toEqual([
      '2025-01',
      '2025-03',
    ]);
    expect(result.eligibleMonthly[1]?.derivedCumulativeDelta).toBe(10);
    expect(result.gapCount).toBe(1);
  });

  it('tracks field support independently without turning invalid values into zero', () => {
    const result = analyzeTrueCost(payload({
      monthly_breakdown: [{
        month: '2025-04',
        ev_cost: '10',
        equiv_gas_cost: 20,
        savings: null,
        cumulative_savings: Number.POSITIVE_INFINITY,
        energy_wh: 0,
      }],
    }));
    const row = result.eligibleMonthly[0]!;

    expect(row.evCost.availability).toBe('invalid');
    expect(row.gasCost.value).toBe(20);
    expect(row.energyWh.value).toBe(0);
    expect(row.apiSavings.availability).toBe('missing');
    expect(row.apiCumulative.availability).toBe('invalid');
    expect(row.derivedFuelDelta).toBeNull();
    expect(result.monthlyAccounting).toMatchObject({
      evCostSupportRows: 0,
      gasCostSupportRows: 1,
      energySupportRows: 1,
      apiSavingsSupportRows: 0,
      apiCumulativeSupportRows: 0,
    });
  });

  it('does not mutate the input array or any row', () => {
    const source = payload();
    const before = structuredClone(source);

    analyzeTrueCost(source);

    expect(source).toEqual(before);
  });
});

describe('analyzeTrueCost evidence gates and signs', () => {
  it('detects a true zero envelope and withholds the backend maintenance floor', () => {
    const result = analyzeTrueCost(payload({
      total_charging_cost: 0,
      total_wh: 0,
      total_sessions: 0,
      total_km: 0,
      first_date: '',
      last_date: '',
      months_of_ownership: 1,
      cost_per_km_ev: 0,
      cost_per_km_ice: 0,
      equivalent_gas_cost: 0,
      total_savings: 0,
      monthly_savings: 0,
      maintenance_savings_estimate: 50,
      monthly_breakdown: [],
    }));

    expect(result.zeroEnvelope).toBe(true);
    expect(result.gates.fuelComparison).toBe(false);
    expect(result.gates.maintenanceHeuristic).toBe(false);
    expect(result.combinedFuelAndMaintenance).toBeNull();
    expect(result.identities.find((row) =>
      row.id === 'maintenance_heuristic')?.status).toBe('unavailable');
  });

  it('allows the maintenance heuristic only with observed positive-drive span evidence', () => {
    const result = analyzeTrueCost(payload());

    expect(result.driveSpan.available).toBe(true);
    expect(result.driveSpan.spanDays).toBe(273);
    expect(result.gates.maintenanceHeuristic).toBe(true);
  });

  it('preserves negative fuel deltas as losses', () => {
    const result = analyzeTrueCost(payload({
      total_charging_cost: 350,
      equivalent_gas_cost: 300,
      total_savings: -50,
      monthly_savings: -5,
      maintenance_savings_estimate: 0,
    }));

    expect(result.gates.fuelComparison).toBe(true);
    expect(result.fuelDisposition).toBe('loss');
    expect(result.metrics.totalFuelDelta.value).toBe(-50);
  });
});

describe('analyzeTrueCost break-even and scenarios', () => {
  it('derives break-even gasoline price and comparison MPG', () => {
    const result = analyzeTrueCost(payload());

    expect(result.breakEven.gasPricePerConfiguredUnit).toBeCloseTo(4 / 3, 10);
    expect(result.breakEven.comparisonMpg).toBeCloseTo(90, 10);
  });

  it('builds exactly nine bounded algebraic scenarios with price/MPG scaling', () => {
    const result = analyzeTrueCost(payload());
    const scenario = result.sensitivity.find((row) =>
      row.priceFactor === 1.2 && row.mpgFactor === 0.8);

    expect(result.sensitivity).toHaveLength(9);
    expect(scenario?.modeledGasCost).toBeCloseTo(450, 10);
    expect(scenario?.fuelDelta).toBeCloseTo(350, 10);
    expect(scenario?.disposition).toBe('savings');
    expect(result.sensitivity.find((row) =>
      row.priceFactor === 1 && row.mpgFactor === 1)?.modeledGasCost).toBe(300);
  });

  it('withholds break-even and scenarios when a denominator is unsupported', () => {
    const result = analyzeTrueCost(payload({ gas_price: 0 }));

    expect(result.gates.scenarioAnalysis).toBe(false);
    expect(result.breakEven.gasPricePerConfiguredUnit).toBeNull();
    expect(result.breakEven.comparisonMpg).toBeNull();
    expect(result.sensitivity).toEqual([]);
  });
});

describe('analyzeTrueCost accounting identities', () => {
  it('balances all complete baseline identities within explicit tolerances', () => {
    const result = analyzeTrueCost(payload());

    expect(result.identities).toHaveLength(8);
    expect(result.identities.every((check) => check.tolerance > 0)).toBe(true);
    expect(result.identities.every((check) => check.status === 'balances')).toBe(true);
  });

  it('flags an independently inconsistent total fuel delta', () => {
    const result = analyzeTrueCost(payload({ total_savings: 201 }));
    const check = result.identities.find((row) => row.id === 'fuel_total');

    expect(check).toMatchObject({
      expected: 200,
      observed: 201,
      residual: 1,
      status: 'outside_tolerance',
    });
  });

  it('marks monthly aggregate checks unavailable when terminal rows were rejected', () => {
    const baseline = payload();
    const monthly = baseline.monthly_breakdown as unknown[];
    const result = analyzeTrueCost(payload({
      monthly_breakdown: [...monthly, { month: 'bad', ev_cost: 10 }],
    }));

    expect(result.identities.find((row) =>
      row.id === 'monthly_ev_total')?.status).toBe('unavailable');
    expect(result.identities.find((row) =>
      row.id === 'monthly_energy_total')?.status).toBe('unavailable');
  });
});
