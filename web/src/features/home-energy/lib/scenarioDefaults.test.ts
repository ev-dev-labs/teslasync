import { describe, expect, it } from 'vitest';
import { buildTariffSeries, defaultDepartureSlot, DEFAULT_TARIFF_SCENARIO } from './scenarioDefaults';

describe('buildTariffSeries', () => {
  it('marks slots inside the peak window with the peak rate and others off-peak', () => {
    const series = buildTariffSeries(DEFAULT_TARIFF_SCENARIO, '2024-06-01T00:00:00.000Z', 60, 24);
    expect(series).toHaveLength(24);
    // Default peak window is 16:00–21:00 UTC.
    expect(series[10].importPricePerKwh).toBe(DEFAULT_TARIFF_SCENARIO.importOffPeakPerKwh);
    expect(series[16].importPricePerKwh).toBe(DEFAULT_TARIFF_SCENARIO.importPeakPerKwh);
    expect(series[20].importPricePerKwh).toBe(DEFAULT_TARIFF_SCENARIO.importPeakPerKwh);
    expect(series[21].importPricePerKwh).toBe(DEFAULT_TARIFF_SCENARIO.importOffPeakPerKwh);
    for (const slot of series) {
      expect(slot.exportPricePerKwh).toBe(DEFAULT_TARIFF_SCENARIO.exportPerKwh);
    }
  });

  it('supports an overnight-wrapping peak window', () => {
    const wrapping = { ...DEFAULT_TARIFF_SCENARIO, peakStartHour: 22, peakEndHour: 6 };
    const series = buildTariffSeries(wrapping, '2024-06-01T00:00:00.000Z', 60, 24);
    expect(series[23].importPricePerKwh).toBe(wrapping.importPeakPerKwh); // 23:00
    expect(series[2].importPricePerKwh).toBe(wrapping.importPeakPerKwh); // 02:00
    expect(series[12].importPricePerKwh).toBe(wrapping.importOffPeakPerKwh); // 12:00
  });

  it('never throws and returns an empty array for a non-positive horizon', () => {
    expect(() => buildTariffSeries(DEFAULT_TARIFF_SCENARIO, 'not-a-date', 15, -3)).not.toThrow();
    expect(buildTariffSeries(DEFAULT_TARIFF_SCENARIO, 'not-a-date', 15, -3)).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const a = buildTariffSeries(DEFAULT_TARIFF_SCENARIO, '2024-06-01T00:00:00.000Z', 15, 96);
    const b = buildTariffSeries(DEFAULT_TARIFF_SCENARIO, '2024-06-01T00:00:00.000Z', 15, 96);
    expect(a).toEqual(b);
  });
});

describe('defaultDepartureSlot', () => {
  it('resolves the next occurrence of the departure hour within the horizon', () => {
    // Start at 00:00 UTC, departure hour 7 -> slot 28 at 15-min resolution (7h * 4).
    const slot = defaultDepartureSlot(7, '2024-06-01T00:00:00.000Z', 15, 96);
    expect(slot).toBe(28);
  });

  it('wraps to the next day when the departure hour has already passed', () => {
    // Start at 09:00 UTC, departure hour 7 -> next day 07:00 = 22 hours later = slot 88.
    const slot = defaultDepartureSlot(7, '2024-06-01T09:00:00.000Z', 15, 200);
    expect(slot).toBe(88);
  });

  it('returns null when the resolved slot falls outside the horizon', () => {
    const slot = defaultDepartureSlot(7, '2024-06-01T09:00:00.000Z', 15, 10);
    expect(slot).toBeNull();
  });

  it('never throws on an invalid start time', () => {
    expect(() => defaultDepartureSlot(7, 'garbage', 15, 96)).not.toThrow();
    expect(defaultDepartureSlot(7, 'garbage', 15, 96)).toBeNull();
  });
});
