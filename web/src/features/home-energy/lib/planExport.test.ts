import { describe, expect, it } from 'vitest';
import { optimizeHomeEnergy } from './optimizer';
import { buildCanonicalPlan, PLAN_EXPORT_SCHEMA_VERSION, serializeCanonicalPlan } from './planExport';
import type { OrchestrationInput } from './types';

function sampleInput(): OrchestrationInput {
  return {
    slotMinutes: 15,
    horizonSlots: 4,
    startTimeIso: '2024-06-01T00:00:00.000Z',
    vehicles: [],
    solarForecastW: [0, 0, 0, 0],
    loadForecastW: [0, 0, 0, 0],
    tariff: [
      { importPricePerKwh: 0.2, exportPricePerKwh: 0.05 },
      { importPricePerKwh: 0.2, exportPricePerKwh: 0.05 },
      { importPricePerKwh: 0.2, exportPricePerKwh: 0.05 },
      { importPricePerKwh: 0.2, exportPricePerKwh: 0.05 },
    ],
    powerwall: null,
    grid: { maxImportW: 10_000, maxExportW: 10_000 },
  };
}

describe('buildCanonicalPlan / serializeCanonicalPlan', () => {
  it('bundles schema version, input, result, and a non-autonomy disclaimer', () => {
    const input = sampleInput();
    const result = optimizeHomeEnergy(input);
    const plan = buildCanonicalPlan(input, result, '2024-06-01T00:00:00.000Z');

    expect(plan.schemaVersion).toBe(PLAN_EXPORT_SCHEMA_VERSION);
    expect(plan.input).toEqual(input);
    expect(plan.result).toEqual(result);
    expect(plan.disclaimer.toLowerCase()).toContain('does not send any command');
  });

  it('serializes to valid, deterministic JSON', () => {
    const input = sampleInput();
    const result = optimizeHomeEnergy(input);
    const plan = buildCanonicalPlan(input, result, '2024-06-01T00:00:00.000Z');

    const a = serializeCanonicalPlan(plan);
    const b = serializeCanonicalPlan(plan);
    expect(a).toBe(b);
    expect(() => JSON.parse(a)).not.toThrow();
    expect(JSON.parse(a).schemaVersion).toBe(1);
  });
});
