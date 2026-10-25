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
  it.each([
    ['2026-03-07T08:00:00Z', '2026-03-08T08:00:00Z', [0, 100, 300, 400, 500, 600]],
    ['2026-10-31T07:00:00Z', '2026-11-01T07:00:00Z', [0, 100, 100, 200, 300, 400]],
  ] as const)('matches historical local clock buckets across DST from %s', (historyStart, startTimeIso, expected) => {
    const history = Array.from({ length: 24 }, (_, hour) => entry({
      timestamp: new Date(Date.parse(historyStart) + hour * 3_600_000).toISOString(),
      solar_energy_wh: hour * 100,
    }));
    const original = JSON.stringify(history);
    const forecast = buildSolarForecast(history, {
      timezone: 'America/Los_Angeles', startTimeIso, slotMinutes: 60, horizonSlots: expected.length,
    });
    expect(forecast.seriesW).toEqual(expected);
    expect(forecast.sourceSampleCount).toBe(24);
    expect(JSON.stringify(history)).toBe(original);
  });

  it('returns zero confidence and an all-quiet series when no history is available', () => {
    const result = buildSolarForecast([], { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 8 });
    expect(result.confidence).toBe(0);
    expect(result.quality).toBe('none');
    expect(result.seriesW).toHaveLength(8);
    expect(result.seriesW.every((w) => w === 0)).toBe(true);
    expect(result.sourceSampleCount).toBe(0);
    expect(result.latestSampleIso).toBeNull();
  });

  it('never throws on malformed / null entries and ignores them', () => {
    const bad = [null, undefined, {}, { timestamp: 'not-a-date' }, entry({ timestamp: '2024-06-01T12:00:00.000Z', solar_energy_wh: -5 })] as unknown as TeslaEnergyHistoryEntry[];
    expect(() => buildSolarForecast(bad, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 })).not.toThrow();
    const result = buildSolarForecast(bad, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    expect(result.sourceSampleCount).toBe(0);
  });

  it('derives a plausible midday-peaking solar curve from a full day of samples with high confidence', () => {
    const day = buildSyntheticDay('2024-06-01T00:00:00.000Z', 6000);
    const result = buildSolarForecast(day, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 96 });

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
    const first = buildSolarForecast(day, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 192 });
    const second = buildSolarForecast(day, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 192 });
    expect(first.seriesW).toEqual(second.seriesW);
    // Same time-of-day 24h later (96 slots at 15-min) must repeat the shape.
    expect(first.seriesW[10]).toBeCloseTo(first.seriesW[10 + 96], 6);
  });

  it('fills unsampled slots from the nearest sampled neighbor instead of leaving hard zero gaps', () => {
    const sparse: TeslaEnergyHistoryEntry[] = [
      entry({ timestamp: '2024-06-01T12:00:00.000Z', solar_energy_wh: 500 }),
      entry({ timestamp: '2024-06-01T12:05:00.000Z', solar_energy_wh: 500 }),
    ];
    const result = buildSolarForecast(sparse, { timezone: 'UTC', startTimeIso: '2024-06-01T12:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    // Every slot should inherit the one sampled value since it's the only data point in the day.
    expect(result.seriesW.every((w) => w > 0)).toBe(true);
    expect(result.quality).toBe('low');
  });
});

describe('buildLoadForecast', () => {
  const options = { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 };

  it.each([null, undefined, []])('does not invent a measured load series from missing history (%j)', (history) => {
    expect(buildLoadForecast(history, options)).toMatchObject({
      seriesW: [], confidence: 0, quality: 'none', sourceSampleCount: 0,
      latestSampleIso: null, sourceQuality: 'missing',
    });
  });

  it('ignores invalid values and timestamps without treating them as measured zero', () => {
    const history = [
      entry({ timestamp: options.startTimeIso }),
      entry({ timestamp: options.startTimeIso, consumer_energy_wh: undefined }),
      entry({ timestamp: options.startTimeIso, consumer_energy_wh: NaN }),
      entry({ timestamp: options.startTimeIso, consumer_energy_wh: Infinity }),
      entry({ timestamp: options.startTimeIso, consumer_energy_wh: -Infinity }),
      entry({ timestamp: 'invalid', consumer_energy_wh: 0 }),
      entry({ timestamp: options.startTimeIso, solar_energy_wh: 500 }),
    ];
    expect(buildLoadForecast(history, options)).toMatchObject({
      seriesW: [], confidence: 0, quality: 'none', sourceSampleCount: 0,
      latestSampleIso: null, sourceQuality: 'missing',
    });
  });

  it.each([
    null, undefined, [],
    [entry({ timestamp: options.startTimeIso, consumer_energy_wh: NaN })],
  ])('discloses an explicitly assumed zero-load scenario without claiming source observations (%j)', (history) => {
    expect(buildLoadForecast(history, { ...options, assumeZeroLoad: true })).toMatchObject({
      seriesW: [0, 0, 0, 0], confidence: 0, quality: 'none', sourceSampleCount: 0,
      latestSampleIso: null, sourceQuality: 'assumed-zero',
    });
  });

  it.each([0, -5, 5, -0.125, 0.125])('retains measured signed and fractional energy %s Wh', (wh) => {
    const history = [entry({ timestamp: options.startTimeIso, consumer_energy_wh: wh })];
    const result = buildLoadForecast(history, { ...options, assumeZeroLoad: true });
    expect(result).toMatchObject({
      quality: 'low', sourceSampleCount: 1,
      latestSampleIso: options.startTimeIso, sourceQuality: 'measured',
    });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.seriesW).toHaveLength(4);
    for (const power of result.seriesW) expect(power).toBeCloseTo(wh * 12, 10);
  });

  it('reads consumer_energy_wh independently of the solar field', () => {
    const day = buildSyntheticDay('2024-06-01T00:00:00.000Z', 6000);
    const result = buildLoadForecast(day, { timezone: 'UTC', startTimeIso: '2024-06-01T00:00:00.000Z', slotMinutes: 15, horizonSlots: 4 });
    expect(result.seriesW.every((w) => Math.abs(w - 200) < 1)).toBe(true);
  });
});
