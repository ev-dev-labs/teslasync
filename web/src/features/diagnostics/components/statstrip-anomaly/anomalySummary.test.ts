import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { AnomalyData } from '@/api/hooks/useAnomalies';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { anomalySummary } from './anomalySummary';

const i18n = createInstance();
void i18n.init({ lng: 'en', resources: {}, initImmediate: false });
const preferences: MetricPreferences = {
  units: {
    distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 3, locale: 'de-DE',
  },
  currency: { kind: 'symbol', value: '€' },
};

describe('anomaly summary source preservation', () => {
  it('keeps all four source counts without replacing the fixed windows with a common range', () => {
    const data: AnomalyData = {
      anomalies: [], health_summary: { battery: 'normal', tires: 'warning' },
      signals_monitored: 12345, anomalies_last_7d: 17, anomalies_last_24h: 0,
    };
    const before = JSON.stringify(data);
    const summary = anomalySummary(data, i18n.t);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([12345, 17, 0, 2]);
    expect(summary.metrics.map(metric => metric.metricId)).toEqual(['count', 'count', 'count', 'count']);
    expect(summary.metrics.map(metric => metric.context)).toEqual([
      'Current detector snapshot', 'Last 7 days', 'Last 24 hours', 'Current detector snapshot',
    ]);
    expect(summary.period.kind).toBe('unknown');
    expect(summary.period.label).toBe('Current snapshot · last 7 days · last 24 hours');
    expect(summary.metrics.map(metric => formatMetric(
      metric.metricId, metric.rawValue, preferences, undefined, metric.display,
    ).text)).toEqual(['12345', '17', '0', '2']);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('retains missing values rather than manufacturing zero coverage or categories', () => {
    const summary = anomalySummary(undefined, i18n.t);
    expect(summary.metrics).toHaveLength(4);
    for (const metric of summary.metrics) {
      expect(metric.rawValue == null).toBe(true);
      expect(formatMetric(metric.metricId, metric.rawValue, preferences).state).toBe('missing');
    }
  });
});
