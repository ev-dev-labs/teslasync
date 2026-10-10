import { describe, expect, it } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { convertPressureFromSI, PASCALS_PER_KPA, type PressureUnitPref } from '@/lib/unitConversion';
import type { TirePressureReading } from '../../pages/TirePressurePage';
import { chronologicalPressure, pressureChartRows, readPressurePa, summarisePressure } from './pressureData';

const converter = (unit: PressureUnitPref) => (pa: number) => convertPressureFromSI(pa / PASCALS_PER_KPA, unit);

const reading: TirePressureReading = {
  id: 9, vehicle_id: 42, created_at: '2026-06-15T09:00:00Z',
  front_left: 280_000, front_right: 285_000, rear_left: 290_000, rear_right: 295_000,
};
const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
  },
  currency: { kind: 'symbol', value: '$' },
};

describe('canonical pressure presentation — no source-unit guessing', () => {
  it('retains every original Pa field and converts only the presentation boundary', () => {
    const original = { ...reading };
    expect(['fl', 'fr', 'rl', 'rr'].map(pos => readPressurePa(reading, pos as 'fl' | 'fr' | 'rl' | 'rr')))
      .toEqual([280_000, 285_000, 290_000, 295_000]);
    expect(pressureChartRows([reading], converter('bar'))[0]).toMatchObject({ fl: 2.8, fr: 2.85, rl: 2.9, rr: 2.95 });
    expect(pressureChartRows([reading], converter('kPa'))[0]).toMatchObject({ fl: 280, fr: 285, rl: 290, rr: 295 });
    expect(converter('psi')(300_000)).toBeCloseTo(43.5113, 3);
    expect(reading).toEqual(original);
    // A small *Pa* measurement must never be reinterpreted as bar or psi.
    expect(readPressurePa({ ...reading, front_left: 3 }, 'fl')).toBe(3);
    expect(converter('bar')(3)).toBe(0.00003);
  });

  it('keeps missing, nonfinite and inherited zero sentinels out of aggregates and chart values', () => {
    const partial = { ...reading, front_left: null, front_right: 0, rear_left: Number.NaN, rear_right: 300_000 };
    expect(summarisePressure(partial)).toEqual({ avg: 300_000, min: 300_000, warningCount: 0, reportedCount: 1 });
    expect(pressureChartRows([partial], converter('bar'))[0]).toMatchObject({ fl: null, fr: null, rl: null, rr: 3 });
    expect(summarisePressure({ ...partial, rear_right: undefined })).toBeNull();
    expect(summarisePressure(null)).toBeNull();
    expect(readPressurePa({ ...reading, front_left: Infinity }, 'fl')).toBeNull();
    expect(readPressurePa({ ...reading, front_left: -1 }, 'fl')).toBeNull();
    expect(formatMetric('count', null, preferences).state).toBe('missing');
    expect(formatMetric('count', 0, preferences).text).toBe('0');
  });

  it('preserves exact normal-band boundaries and arithmetic over reported corners', () => {
    expect(summarisePressure({ ...reading, front_left: 250_000, front_right: 350_000, rear_left: 249_999, rear_right: 350_001 }))
      .toEqual({ avg: 300_000, min: 249_999, warningCount: 2, reportedCount: 4 });
  });

  it('preserves row multiplicity and chronology without mutating source ordering', () => {
    const newer = { ...reading, id: 2, created_at: '2026-06-20T09:00:00Z' };
    const rows = [newer, reading, { ...reading, id: 10 }];
    expect(chronologicalPressure(rows).map(row => row.id)).toEqual([9, 10, 2]);
    expect(rows.map(row => row.id)).toEqual([2, 9, 10]);
    expect(pressureChartRows(chronologicalPressure(rows), converter('bar'))).toHaveLength(3);
    expect(chronologicalPressure(undefined)).toEqual([]);
  });

  it('uses the canonical formatter for locale, precision and unit preferences without rewriting raw Pa', () => {
    const summary = summarisePressure(reading)!;
    const kpa = summary.avg / 1000;
    expect(formatMetric('pressure', kpa, preferences).text).toBe('2.88 bar');
    const psi = { ...preferences, units: { ...preferences.units, pressure: 'psi' as const, precision: 3 } };
    expect(formatMetric('pressure', kpa, psi).text).toBe('41.698 psi');
    const german = { ...preferences, units: { ...preferences.units, locale: 'de-DE', precision: 1 } };
    expect(formatMetric('pressure', kpa, german).text).toBe('2,9 bar');
    expect(summary.avg).toBe(287_500);
    expect(preferences.units.pressure).toBe('bar');
  });
});

describe('independent source trust and ages', () => {
  it('retains exact source values and age on refresh failure, with retry still reachable', () => {
    let retries = 0;
    const source = deriveDataState({ data: [reading], error: new Error('refresh'), dataUpdatedAt: 1000,
      refetch: () => { retries += 1; } }, { provenance: 'historical', now: () => 6000 });
    expect(source.data?.[0]).toBe(reading);
    expect(source.fatalError).toBeNull();
    expect(source.refreshError?.message).toBe('refresh');
    expect(source.status).toBe('stale');
    expect(source.ageMs).toBe(5000);
    source.retry?.();
    expect(retries).toBe(1);
    const independent = deriveDataState({ data: reading }, { provenance: 'cached' });
    expect(independent.status).toBe('ok');
  });

  it('distinguishes first-load failure, loading, authoritative empty, partial and paused', () => {
    expect(deriveDataState({ error: new Error('first') }).fatalError?.message).toBe('first');
    expect(deriveDataState({ isLoading: true }).status).toBe('initial');
    expect(deriveDataState({ data: [] }, { unavailable: true }).status).toBe('unavailable');
    expect(deriveDataState({ data: reading }, { partial: true }).status).toBe('partial');
    const paused = deriveDataState({ data: reading, fetchStatus: 'paused' });
    expect(paused.data).toBe(reading);
    expect(paused.status).toBe('stale');
    expect(paused.isRefreshBlocked).toBe(true);
    expect(paused.ageMs).toBeNull();
  });
});
