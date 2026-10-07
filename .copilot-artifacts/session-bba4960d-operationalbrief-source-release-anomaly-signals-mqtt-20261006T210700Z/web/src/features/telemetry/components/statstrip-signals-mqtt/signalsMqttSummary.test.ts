import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { signalsWorkspaceSummary, signalsDiffSummary } from './signalsSummary';
import { mqttSummary } from './mqttSummary';

const i18n = createInstance();
void i18n.init({ lng: 'en', resources: {}, initImmediate: false });
const preferences: MetricPreferences = {
  units: {
    distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 3, locale: 'de-DE',
  },
  currency: { kind: 'symbol', value: '€' },
};

describe('Signals and MQTT summary source contracts', () => {
  it('retains text mode semantics, locale-aware selection/pins and a numeric integer-rate display', () => {
    const source = { selected: 12345, pinned: 2, isLive: true, isCompare: false, rate: 5, connected: true, locale: 'de-DE' };
    const summary = signalsWorkspaceSummary(source, i18n.t);
    expect(summary.metrics.map(metric => metric.metricId)).toEqual(['count', 'status', 'rate', 'count']);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([12345, 'Live', 5, 2]);
    expect(summary.metrics.map(metric => formatMetric(
      metric.metricId, metric.rawValue, preferences, undefined, metric.display,
    ).text)).toEqual(['12.345', 'Live', '5 /s', '2']);
    expect(summary.metrics[2].context).toContain('Last-second SSE event count');
    const historical = signalsWorkspaceSummary({ ...source, isLive: false }, i18n.t);
    expect(historical.metrics[1].rawValue).toBe('Historical');
    expect(historical.metrics[2].rawValue).toBeNull();
    expect(signalsWorkspaceSummary({ ...source, isLive: false, isCompare: true }, i18n.t).metrics[1].rawValue).toBe('Compare');
    expect(source.rate).toBe(5);
  });

  it('preserves raw sub-second snapshot separation and independent filtered/pinned counts', () => {
    const summary = signalsDiffSummary({
      changed: 12345, visible: 0, pinned: 2,
      atA: '2026-10-01T00:00:00.000Z', atB: '2026-10-01T01:00:00.123Z',
    }, i18n.t);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([12345, 0, 2, 3600.123]);
    expect(summary.metrics.map(metric => formatMetric(
      metric.metricId, metric.rawValue, preferences, undefined, metric.display,
    ).text)).toEqual(['12345', '0', '2', '3600.123 s']);
    expect(summary.period.label).toBe('Two selected snapshots');
    expect(summary.metrics[2].context).toBe('Current workspace state');
    const absent = signalsDiffSummary({ changed: null, visible: null, pinned: 2, atA: '', atB: '' }, i18n.t);
    expect(absent.metrics.map(metric => metric.rawValue)).toEqual([null, null, 2, null]);
  });

  it('preserves MQTT cumulative totals and source rate precision independently of duration preferences', () => {
    const source = {
      available: true, vehicles: 2, signals: 12345, batches: 678, rate: 3.45,
      observedAt: '2026-10-01T00:00:00Z', precision: 2, locale: 'de-DE',
    };
    const summary = mqttSummary(source, i18n.t);
    expect(summary.metrics.map(metric => metric.rawValue)).toEqual([2, 12345, 678, 3.45]);
    expect(summary.metrics.map(metric => formatMetric(
      metric.metricId, metric.rawValue, preferences, undefined, metric.display,
    ).text)).toEqual(['2', '12.345', '678', '3,45']);
    expect(summary.period.kind).toBe('snapshot');
    if (summary.period.kind === 'snapshot') expect(summary.period.observedAt).toBe(source.observedAt);
    expect(source.rate).toBe(3.45);
    expect(mqttSummary({ ...source, available: false }, i18n.t).metrics.map(metric => metric.rawValue))
      .toEqual([null, null, null, null]);
    expect(mqttSummary({ ...source, vehicles: 0, signals: 0, batches: 0, rate: 0 }, i18n.t).metrics.map(metric => metric.rawValue))
      .toEqual([0, 0, 0, 0]);
  });
});
