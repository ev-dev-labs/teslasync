import { describe, expect, it } from 'vitest';
import type { TeslaEnergyHistoryEntry } from '@/types/energy';
import { buildLoadForecast } from './forecastAdapters';
import { optimizeHomeEnergy } from './optimizer';
import type { OrchestrationInput } from './types';
import typesSource from './types.ts?raw';

describe('household load input contract', () => {
  it('discloses undecomposable historical charging without claiming it is excluded', () => {
    const loadDocumentation = typesSource.match(/\/\*\*((?:(?!\*\/)[^])*)\*\/\s*loadForecastW:/)?.[1];
    expect(loadDocumentation).toBeDefined();
    expect(loadDocumentation).toContain('already include historical vehicle charging');
    expect(loadDocumentation).toContain('cannot be decomposed');
    expect(loadDocumentation).toContain('without inventing a charging');
    expect(loadDocumentation).not.toContain('excludes vehicle charging');
  });

  it.each([200, 7400])('preserves populated consumer observations of %i W without subtraction', (observedPowerW) => {
    const history: TeslaEnergyHistoryEntry[] = [0, 5, 10].map((minute) => ({
      id: minute + 1,
      energy_site_id: 1,
      period: 'day',
      timestamp: `2024-06-01T00:${String(minute).padStart(2, '0')}:00.000Z`,
      fetched_at: '2024-06-01T01:00:00.000Z',
      consumer_energy_wh: observedPowerW / 12,
      solar_energy_wh: null,
      battery_energy_in_wh: null,
      battery_energy_out_wh: null,
      grid_energy_in_wh: null,
      grid_energy_out_wh: null,
    }));
    const originalHistory = structuredClone(history);
    const forecast = buildLoadForecast(history, {
      startTimeIso: history[0].timestamp,
      slotMinutes: 15,
      horizonSlots: 1,
    });
    const input: OrchestrationInput = {
      startTimeIso: history[0].timestamp,
      slotMinutes: 15,
      horizonSlots: 1,
      loadForecastW: forecast.seriesW,
      solarForecastW: [0],
      vehicles: [{
        id: '1', name: 'Vehicle', currentSocPct: 0, targetSocPct: 100,
        usableCapacityWh: 250, maxChargePowerW: 1000, departureSlot: 1,
        priority: 'medium',
      }],
      tariff: [{ importPricePerKwh: 0.2, exportPricePerKwh: 0 }],
      powerwall: null,
      grid: { maxImportW: 20_000, maxExportW: 20_000 },
    };
    const result = optimizeHomeEnergy(input);

    expect(forecast.seriesW[0]).toBeCloseTo(observedPowerW, 6);
    expect(forecast.sourceSampleCount).toBe(3);
    expect(history).toEqual(originalHistory);
    expect(result.slots[0].loadW).toBeCloseTo(observedPowerW, 6);
    expect(result.slots[0].vehicleChargeW).toBeCloseTo(1000, 6);
    expect(result.slots[0].gridImportW).toBeCloseTo(observedPowerW + 1000, 6);
    expect(result.vehicles[0].readinessAchieved).toBe(true);
  });
});
