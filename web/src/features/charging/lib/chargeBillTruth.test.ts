import { describe, expect, it } from 'vitest';

import { deriveChargeBillTruth } from './chargeBillTruth';

describe('deriveChargeBillTruth', () => {
  it('explains session 254 cabinet vs pack and leftover dollars', () => {
    const truth = deriveChargeBillTruth({
      chargerType: 'Supercharger',
      measuredEnergyWh: 42_620,
      measuredCost: 20.88,
      billedEnergyWh: 44_490.6,
      billedCost: 21.80,
      billedRatePerKwh: 0.49,
      billedCurrency: 'USD',
      billedSource: 'tesla_charging_history',
      billedSite: 'Hayward, CA',
    });

    expect(truth.hasInvoice).toBe(true);
    expect(truth.energyDeltaWh).toBeCloseTo(1_870.6, 1);
    expect(truth.reasons).toContain('cabinet_vs_pack');
    expect(truth.reasons).not.toContain('idle_or_tax');
    expect(truth.honesty).toBe('live');
    expect(truth.impliedEnergyCost).toBeCloseTo(21.800394, 3);
  });

  it('treats leftover dollars beyond energy × rate as idle or tax, not pack kWh', () => {
    const truth = deriveChargeBillTruth({
      chargerType: 'Supercharger',
      measuredEnergyWh: 42_620,
      billedEnergyWh: 44_490.6,
      billedCost: 23.50,
      billedRatePerKwh: 0.49,
    });
    expect(truth.reasons).toContain('idle_or_tax');
    expect(truth.honesty).toBe('guessed');
  });

  it('does not invent an invoice', () => {
    const truth = deriveChargeBillTruth({
      chargerType: 'Supercharger',
      measuredEnergyWh: 12_000,
      measuredCost: 4,
    });
    expect(truth.hasInvoice).toBe(false);
    expect(truth.reasons).toContain('no_invoice');
    expect(truth.honesty).toBe('missing');
  });
});
