import { afterEach, describe, expect, it } from 'vitest';
import { fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import {
  convertDistanceFromSI, convertDurationFromSI, convertEfficiencyFromSI,
  convertEnergyFromSI, convertPowerFromSI, convertPressureFromSI,
  convertSpeedFromSI, convertTempFromSI,
} from '@/lib/unitConversion';
import { formatFixtures } from '@/features/developer-reference/stats/fixtures';
import { formatMetric, glossary, type MetricId, type MetricPreferences } from './index';

const prefs: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};
const initial = getFormatterPreferences();
afterEach(() => { setGlobalPrecision(initial.precision); setGlobalLocale(initial.locale); });

describe('candidate formatMetric preserves measurements and preference policy', () => {
  it.each(Object.keys(glossary).filter(id => !['text', 'status'].includes(glossary[id as MetricId].format)) as MetricId[])(
    '%s handles zero, -0, missing and nonfinite inputs explicitly', id => {
      expect(formatMetric(id, 0, prefs).state).toBe('value');
      expect(formatMetric(id, -0, prefs).text).toBe(formatMetric(id, 0, prefs).text);
      for (const raw of [null, undefined]) expect(formatMetric(id, raw, prefs).state).toBe('missing');
      for (const raw of [NaN, Infinity, -Infinity]) expect(formatMetric(id, raw, prefs).state).toBe('invalid');
    },
  );
  it.each(formatFixtures)('retains original fixture $id independently of formatting', fixture => {
    const preferences = { ...prefs, units: { ...prefs.units, ...fixture.units } };
    const result = formatMetric(fixture.metricId, fixture.rawValue, preferences);
    expect(Object.is(result.rawValue, fixture.rawValue)).toBe(true);
    expect(result.text).not.toMatch(/NaN|undefined|null|Infinity/);
    expect(result.accessibility).not.toBe('');
    if (fixture.rawValue == null) expect(result.state).toBe('missing');
    else if (typeof fixture.rawValue === 'number' && !Number.isFinite(fixture.rawValue))
      expect(result.state).toBe('invalid');
  });
  it.each([
    ['distance', 14500, convertDistanceFromSI(14500, 'km'), 'km'],
    ['energy', 26300, convertEnergyFromSI(26300, 'kWh'), 'kWh'],
    ['power', 12100, convertPowerFromSI(12100, 'kW'), 'kW'],
    ['duration', 3576, convertDurationFromSI(3576, 'h'), 'h'],
    ['speed', 160 / 9, convertSpeedFromSI(160 / 9, 'km/h'), 'km/h'],
    ['temperature', -21.5, convertTempFromSI(-21.5, '°C'), '°C'],
    ['pressure', 250, convertPressureFromSI(250, 'kPa'), 'kPa'],
    ['efficiency', 0.186, convertEnergyFromSI(convertEfficiencyFromSI(186, 'km'), 'kWh'), 'kWh/km'],
  ] as const)('delegates %s canonical display math to existing helpers', (id, raw, display, unit) => {
    const result = formatMetric(id, raw, prefs);
    expect(result.value).toBe(fmtNumber(display, 2, 'en-US'));
    expect(result.unit).toBe(unit);
  });
  it('distinguishes percentage from coefficient and declared counts from numbers', () => {
    expect(formatMetric('percent', 4.5, prefs).text).toBe('4.50%');
    expect(formatMetric('ratio', 0.045, prefs).text).toBe('0.05');
    expect(formatMetric('count', 1240, prefs).text).toBe('1,240');
    expect(formatMetric('number', 1240, prefs).text).toBe('1,240.00');
    for (const raw of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(formatMetric('count', raw, prefs).state).toBe('invalid');
  });
  it('keeps overall rate, mean session power, peak power and recorded cost distinct', () => {
    expect(glossary['charge.overallRate'].description).not.toBe(glossary['charge.meanSessionPower'].description);
    expect(glossary['charge.peakPower'].label).not.toBe(glossary['charge.meanSessionPower'].label);
    expect(glossary['charge.recordedCost'].description).toContain('not tariff estimates');
  });
  it('preserves zero, explicit reasons, null and nonfinite distinctions', () => {
    expect(formatMetric('energy', 0, prefs)).toMatchObject({ state: 'value', text: '0.00 kWh' });
    expect(formatMetric('energy', null, prefs, 'Recorded upstream reason'))
      .toMatchObject({ state: 'missing', value: '—', reason: 'Recorded upstream reason' });
    for (const raw of [NaN, Infinity, -Infinity])
      expect(formatMetric('energy', raw, prefs)).toMatchObject({ state: 'invalid', value: '—' });
    expect(formatMetric('energy', '850', prefs).state).toBe('invalid');
  });
  it('rejects unknown IDs and deliberate text shape mismatches', () => {
    expect(() => formatMetric('invented' as MetricId, 1, prefs)).toThrow('Unknown metric');
    expect(formatMetric('text', 'A', prefs).text).toBe('A');
    expect(formatMetric('status', 85, prefs).state).toBe('invalid');
    expect(formatMetric('status', '', prefs).state).toBe('invalid');
    expect(formatMetric('score', 85, prefs).text).toBe('85.00/100');
  });
  it('does not show raw or display-rounded negative zero, including currency', () => {
    for (const raw of [-0, -0.000001]) {
      expect(formatMetric('currency', raw, prefs).text).toBe('$0.00');
      expect(formatMetric('number', raw, prefs).text).toBe('0.00');
    }
    expect(formatMetric('currency', -33.6, prefs).text).toBe('$-33.60');
    expect(formatMetric('number', -0.005, prefs).value).toBe('-0.01');
  });
  it.each(['en-US', 'de-DE', 'fr-FR', 'ar-EG'])('preserves %s grouping and currency spacing', locale => {
    const local = { ...prefs, units: { ...prefs.units, locale, precision: 4 },
      currency: { kind: 'iso', value: 'EUR' } as const };
    expect(formatMetric('currency', 1204.5, local).text)
      .toBe(formatCurrencyValue(1204.5, 'EUR', locale, 4, { useGrouping: true }));
    expect(formatMetric('energy', 1204500, local).value).toBe(fmtNumber(1204.5, 4, locale));
  });
  it('uses snapshots and tracks fallback preference updates without changing raw values', () => {
    const fallback = { ...prefs, units: { ...prefs.units, precision: undefined, locale: undefined } };
    setGlobalPrecision(1); setGlobalLocale('de-DE');
    expect(formatMetric('energy', 99950, fallback).text).toBe('100,0 kWh');
    setGlobalPrecision(4);
    expect(formatMetric('energy', 99950, fallback).text).toBe('99,9500 kWh');
    expect(formatMetric('energy', 99950, prefs).text).toBe('99.95 kWh');
    expect(formatMetric('duration', 3576, { ...prefs, units: { ...prefs.units, duration: 'min' } }).text).toBe('59.60 min');
  });
  it('switches every physical display preference while retaining canonical raw measurements', () => {
    const changed: MetricPreferences = { ...prefs, units: { ...prefs.units,
      distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'bar',
      energy: 'Wh', duration: 's', power: 'W' } };
    expect(formatMetric('distance', 1609.344, changed)).toMatchObject({ text: '1.00 mi', rawValue: 1609.344 });
    expect(formatMetric('speed', 17.8816, changed).text).toBe('40.00 mph');
    expect(formatMetric('temperature', 0, changed).text).toBe('32.00°F');
    expect(formatMetric('pressure', 250, changed).text).toBe('2.50 bar');
    expect(formatMetric('energy', 850, changed).text).toBe('850.00 Wh');
    expect(formatMetric('duration', 0.25, changed).text).toBe('0.25 s');
    expect(formatMetric('power', 12100, changed).text).toBe('12,100.00 W');
    expect(formatMetric('energy', 850, prefs).text).toBe('0.85 kWh');
  });
  it('adapts Wh/m explicitly to existing helper input and supports feet without mislabeled km', () => {
    const imperial = { ...prefs, units: { ...prefs.units, distance: 'mi' as const, energy: 'Wh' as const } };
    expect(formatMetric('efficiency', 0.186, imperial).value)
      .toBe(fmtNumber(convertEfficiencyFromSI(186, 'mi'), 2, 'en-US'));
    expect(formatMetric('efficiency', 0.186, { ...prefs, units: { ...prefs.units, distance: 'ft', energy: 'Wh' } }).text)
      .toBe('0.06 Wh/ft');
  });
  it('handles finite extremes and conversion overflow explicitly', () => {
    expect(formatMetric('distance', Number.MAX_VALUE, prefs).state).toBe('value');
    expect(formatMetric('speed', Number.MAX_VALUE, prefs).state).toBe('invalid');
    expect(formatMetric('number', Number.MIN_VALUE, prefs).state).toBe('value');
    expect(formatMetric('number', 1, { ...prefs, units: { ...prefs.units, precision: Infinity } }).state).toBe('value');
    expect(formatMetric('currency', 33.6, { ...prefs, units: { ...prefs.units, locale: 'not_a_locale' },
      currency: { kind: 'iso', value: 'USD' } }).text).toBe('$33.60');
  });
});
