import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { deriveDataState } from '@/api/dataState';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { efficiencyMetrics } from './metrics';
import { buildEfficiencyModel } from './model';
import { fakeQuery, fakeStats, fakeUnits } from './fixtures';
import type { StatsPresentation } from './types';

const translator = i18next.createInstance();
await translator.init({ lng: 'en', resources: {}, initImmediate: false });
const t = translator.t.bind(translator);
const fmtNumber = (value: number) => value.toFixed(3);
const fmtInt = (value: number) => value.toFixed(0);

function presentation(stats = fakeStats(), miles = false): StatsPresentation {
  const units = fakeUnits(miles, 3);
  return {
    stats, units, model: buildEfficiencyModel([], units.unitPrefs),
    source: { state: deriveDataState(fakeQuery(stats)), loading: false, malformed: false },
  };
}

describe('efficiency pricing provenance', () => {
  it.each(['€', '£', '$'])('keeps source dollars and km when the selected currency is %s', currency => {
    const props = presentation(fakeStats(), true);
    const result = efficiencyMetrics(props, t, fmtNumber, fmtInt);
    const preferences: MetricPreferences = {
      units: props.units.unitPrefs, currency: { kind: 'symbol', value: currency },
    };
    expect(result.cost).toBeCloseTo(0.024);
    for (const metrics of [result.kpis, result.insights]) {
      const cost = metrics.find(metric => metric.metricId === 'currency')!;
      const formatted = formatMetric(cost.metricId, cost.rawValue, preferences, undefined, cost.display);
      expect(formatted.text).toBe('$0.024 /km');
      expect(cost.context).toContain('assumed $0.12/kWh');
      expect(cost.context).toContain('source dollars per km');
      expect(cost.context).toContain('not recorded spending');
      expect(cost.context).toContain('No currency conversion');
      expect(cost.description).toBe(cost.context);
    }
  });

  it('preserves populated consumption, economy, speed, distance, counts and energy insights', () => {
    const result = efficiencyMetrics(presentation(), t, fmtNumber, fmtInt);
    expect(result.kpis).toHaveLength(8);
    expect(result.insights).toHaveLength(6);
    expect(result.economy).toBe('5.000');
    expect(result.kpis.map(metric => metric.rawValue)).toEqual([
      0.2, '5.000', 60 * 1000 / 3600, 120 * 1000 / 3600, '300 kg', 5000000, 0.024, 42,
    ]);
    expect(result.insights[0].rawValue).toBe(presentation().units.formatEnergy(12000));
    expect(result.insights[1].rawValue).toBe(50);
  });

  it.each([
    { totalDistanceKm: 0 }, { totalDistanceKm: Number.NaN },
    { avgEfficiencyWhKm: Number.NaN }, { avgEfficiencyWhKm: Number.POSITIVE_INFINITY },
  ])('does not fabricate pricing for unavailable operands: %o', overrides => {
    const props = presentation(fakeStats(overrides));
    const result = efficiencyMetrics(props, t, fmtNumber, fmtInt);
    expect(result.cost).toBeNull();
    for (const metrics of [result.kpis, result.insights]) {
      const cost = metrics.find(metric => metric.metricId === 'currency')!;
      expect(cost.rawValue).toBeNull();
      expect(formatMetric(cost.metricId, cost.rawValue, {
        units: props.units.unitPrefs, currency: { kind: 'symbol', value: '€' },
      }, undefined, cost.display).state).toBe('missing');
    }
  });

  it('preserves an observed zero consumption estimate', () => {
    const result = efficiencyMetrics(presentation(fakeStats({ avgEfficiencyWhKm: 0 })), t, fmtNumber, fmtInt);
    expect(result.cost).toBe(0);
    expect(result.economy).toBeNull();
  });
});
