import { describe, expect, it } from 'vitest';
import { buildLoadForecast, buildSolarForecast } from './forecastAdapters';
import type { TeslaEnergyHistoryEntry } from '@/types/energy';

function entry(overrides: Partial<TeslaEnergyHistoryEntry> & Pick<TeslaEnergyHistoryEntry, 'timestamp'>): TeslaEnergyHistoryEntry {
  return {
    id: 1,
    energy_site_id: 1,
    period: 'day',
    solar_energy_wh: null,
    battery_energy_in_wh: null,
    battery_energy_out_wh: null,
    grid_energy_in_wh: null,
    grid_energy_out_wh: null,
    consumer_energy_wh: null,
    fetched_at: overrides.timestamp,
    ...overrides,
  };
}

/** Builds a full synthetic day of 5-minute solar samples: 0 overnight, a bell-ish midday curve. */
function buildSyntheticDay(dateIso: string, peakWh: number): TeslaEnergyHistoryEntry[] {
  const entries: TeslaEnergyHistoryEntry[] = [];
  const base = Date.parse(dateIso);
  for (let m = 0; m < 1440; m += 5) {
    const hour = m / 60;
    // Simple daylight window 06:00–18:00 with a peak at noon.
    const solar = hour >= 6 && hour <= 18 ? Math.max(0, peakWh * Math.sin(((hour - 6) / 12) * Math.PI)) : 0;
    entries.push(entry({ timestamp: new Date(base + m * 60_000).toISOString(), solar_energy_wh: solar * (5 / 60), consumer_energy_wh: 200 * (5 / 60) }));
  }
  return entries;
}

describe('buildSolarForecast', () => {
  it('returns zero confidence and an all-quiet series when no history is available', () => {
    const result = buildSolarForecast([], { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 8 });
    expect(result.confidence).toBe(0);
    expect(result.quality).toBe('none');
    expect(result.seriesW).toHaveLength(8);
    expect(result.seriesW.every((w) => w === 0)).toBe(true);
    expect(result.sourceSampleCount).toBe(0);
    expect(result.latestSampleIso).toBeNull();
  });

  it('never throws on malformed / null entries and ignores them', () => {
    const bad = [null, undefined, {}, { timestamp: 'not-a-date' }, entry({ timestamp: '2024-06-01T12:00:00.000Z', solar_energy_wh: -5 })] as unknown as TeslaEnergyHistoryEntry[];
    expect(() => buildSolarForecast(bad, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 })).not.toThrow();
    const result = buildSolarForecast(bad, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    expect(result.sourceSampleCount).toBe(0);
  });

  it('derives a plausible midday-peaking solar curve from a full day of samples with high confidence', () => {
    const day = buildSyntheticDay('2024-06-01T00:00:00.000Z', 6000);
    const result = buildSolarForecast(day, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 96 });

    expect(result.quality).toBe('high');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.seriesW).toHaveLength(96);

    const noonSlot = Math.floor((12 * 60) / 15); // slot 48
    const midnightSlot = 0;
    expect(result.seriesW[noonSlot]).toBeGreaterThan(result.seriesW[midnightSlot]);
    expect(result.seriesW[midnightSlot]).toBeCloseTo(0, 0);
  });

  it('tiles the day-shape forward across a multi-day horizon deterministically', () => {
    const day = buildSyntheticDay('2024-06-01T00:00:00.000Z', 5000);
    const first = buildSolarForecast(day, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 192 });
    const second = buildSolarForecast(day, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 192 });
    expect(first.seriesW).toEqual(second.seriesW);
    // Same time-of-day 24h later (96 slots at 15-min) must repeat the shape.
    expect(first.seriesW[10]).toBeCloseTo(first.seriesW[10 + 96], 6);
  });

  it('fills unsampled slots from the nearest sampled neighbor instead of leaving hard zero gaps', () => {
    const sparse: TeslaEnergyHistoryEntry[] = [
      entry({ timestamp: '2024-06-01T12:00:00.000Z', solar_energy_wh: 500 }),
      entry({ timestamp: '2024-06-01T12:05:00.000Z', solar_energy_wh: 500 }),
    ];
    const result = buildSolarForecast(sparse, { startTimeIso: '2024-06-01T12:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    // Every slot should inherit the one sampled value since it's the only data point in the day.
    expect(result.seriesW.every((w) => w > 0)).toBe(true);
    expect(result.quality).toBe('low');
  });
});

describe('buildLoadForecast', () => {
  it('reads consumer_energy_wh independently of the solar field', () => {
    const day = buildSyntheticDay('2024-06-01T00:00:00.000Z', 6000);
    const result = buildLoadForecast(day, { startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    expect(result.seriesW.every((w) => Math.abs(w - 200) < 1)).toBe(true);
  });
});
