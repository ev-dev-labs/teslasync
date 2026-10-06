import { describe, expect, it } from 'vitest';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { computeStats, type LiveSignalStats } from '../live-signal-inspector/liveSignalStats';
import { liveSignalMetrics } from './liveSignalMetrics';

const t = (_key: string, fallback: string) => fallback;
const preferences: MetricPreferences = {
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
  },
  currency: { kind: 'symbol', value: '$' },
};

describe('liveSignalMetrics raw source contract', () => {
  it('keeps numeric count operands and canonical seconds with the existing compact specialist age display', () => {
    const stats = computeStats([
      { name: 'speed', value: 3, source: 'l1', ageMs: 101 },
      { name: 'locked', value: false, source: 'stale', ageMs: 200_000 },
      { name: 'name', value: 'car', source: 'l2' },
    ]);
    const metrics = liveSignalMetrics(stats, true, t);
    expect(metrics.map(metric => metric.rawValue)).toEqual([3, 1, 1, 1, 1, 0.101]);
    expect(metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'count', 'count', 'latency']);
    const age = metrics[5];
    expect(formatMetric(age.metricId, age.rawValue, preferences, undefined, age.display)).toMatchObject({
      rawValue: 0.101, state: 'value', text: '101ms',
    });
  });

  it('distinguishes unavailable sources from a successful empty snapshot', () => {
    const empty = computeStats([]);
    expect(liveSignalMetrics(empty, false, t).every(metric => metric.rawValue === undefined)).toBe(true);
    expect(liveSignalMetrics(empty, true, t).map(metric => metric.rawValue)).toEqual([0, 0, 0, 0, 0, undefined]);
  });

  it('retains invalid numerical source inputs for shared validation instead of fabricating zero', () => {
    const stats: LiveSignalStats = { ...computeStats([]), total: NaN, freshestAgeMs: -1 };
    const metrics = liveSignalMetrics(stats, true, t);
    for (const metric of [metrics[0], metrics[5]]) {
      expect(formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display).state).toBe('invalid');
    }
  });

  it('preserves existing seconds, minutes and hours displays after canonical raw normalization', () => {
    for (const [ms, expected] of [[1500, '1.50s'], [120_000, '2m'], [7_200_000, '2.00h']] as const) {
      const metric = liveSignalMetrics({ ...computeStats([]), freshestAgeMs: ms }, true, t)[5];
      expect(metric.rawValue).toBe(ms / 1000);
      expect(formatMetric(metric.metricId, metric.rawValue, preferences, undefined, metric.display).text).toBe(expected);
    }
  });
});
