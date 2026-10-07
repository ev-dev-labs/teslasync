import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('preserves exact safe numeric identifiers without locale grouping or precision changes', () => {
    expect(formatMetric('identifier', 1234567, prefs, undefined, { identifierPrefix: '#' }))
      .toMatchObject({ text: '#1234567', rawValue: 1234567, unit: '' });
    expect(formatMetric('identifier', 0, prefs, undefined, { identifierPrefix: '#' }).text).toBe('#0');
    expect(formatMetric('identifier', null, prefs).state).toBe('missing');
    for (const raw of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(formatMetric('identifier', raw, prefs).state).toBe('invalid');
  });
  it('keeps source notation unrounded for rates and explicit second-based durations', () => {
    expect(formatMetric('rate', 1.23456789, prefs, undefined, { notation: 'source', unit: '/s' }))
      .toMatchObject({ text: '1.23456789 /s', rawValue: 1.23456789 });
    expect(formatMetric('rate', 1.23456789, prefs).text).toBe('1.23');
    expect(formatMetric('duration', 0.123456789, prefs, undefined,
      { notation: 'source', units: { duration: 's' } }).text).toBe('0.123456789 s');
    expect(formatMetric('number', -0.000001, prefs, undefined, { notation: 'source' }).text).toBe('-0.000001');
    expect(formatMetric('count', 1.5, prefs, undefined, { notation: 'source' }).state).toBe('invalid');
    expect(formatMetric('duration', 172800, prefs, undefined, { units: { duration: 'd' } }).text).toBe('2.00 d');
  });
  it('calls specialist formatters only after raw validation and before default physical conversion', () => {
    const formatter = vi.fn((raw: number, preferences: MetricPreferences) => ({
      value: fmtNumber(raw / 86400, preferences.units.precision, preferences.units.locale), unit: 'd',
    }));
    expect(formatMetric('duration', 172800, prefs, undefined, { formatter }))
      .toMatchObject({ text: '2.00 d', rawValue: 172800 });
    expect(formatter).toHaveBeenCalledWith(172800, expect.objectContaining({ units: expect.objectContaining({ locale: 'en-US' }) }));
    formatter.mockClear();
    for (const raw of [null, undefined, NaN, Infinity, '172800'])
      expect(formatMetric('duration', raw, prefs, undefined, { formatter }).state).not.toBe('value');
    expect(formatMetric('count', 1.5, prefs, undefined, { formatter }).state).toBe('invalid');
    expect(formatMetric('identifier', -1, prefs, undefined, { formatter }).state).toBe('invalid');
    expect(formatter).not.toHaveBeenCalled();
    expect(formatMetric('number', 1, prefs, undefined,
      { formatter: () => ({ value: '', unit: '' }) }).state).toBe('invalid');
  });
  it('retains a numeric active-count numerator and total without turning it into a ratio or percentage', () => {
    expect(formatMetric('count', 1, prefs, undefined, { countTotal: 1 }))
      .toMatchObject({ text: '1/1', rawValue: 1, state: 'value' });
    expect(formatMetric('count', 0, prefs, undefined, { countTotal: 0 }).text).toBe('0/0');
    expect(formatMetric('count', 1200, prefs, undefined, { countTotal: 1500 }).text).toBe('1,200/1,500');
    expect(formatMetric('count', 1, prefs).text).toBe('1');
    for (const total of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(formatMetric('count', 1, prefs, undefined, { countTotal: total }).state).toBe('invalid');
    }
    expect(formatMetric('count', null, prefs, undefined, { countTotal: 1 }).state).toBe('missing');
  });
  it('keeps mass and SLO burn multipliers numeric with their distinct display units', () => {
    expect(formatMetric('mass', 123.4, prefs)).toMatchObject({ text: '123.40 kg', rawValue: 123.4 });
    expect(formatMetric('mass', 0, prefs).text).toBe('0.00 kg');
    expect(formatMetric('multiplier', 100, prefs)).toMatchObject({ text: '100.00×', rawValue: 100 });
    expect(formatMetric('multiplier', 0, prefs).text).toBe('0.00×');
    expect(formatMetric('multiplier', null, prefs).state).toBe('missing');
    expect(formatMetric('ratio', 100, prefs).text).toBe('100.00');
    expect(formatMetric('percent', 100, prefs).text).toBe('100.00%');
  });
  it.each([
    [0, '0 B'], [1023, '1023 B'], [1024, '1.00 KB'],
    [1048576, '1.00 MB'], [1073741824, '1.00 GB'],
  ] as const)('formats %s bytes without discarding its numeric source', (raw, text) => {
    expect(formatMetric('bytes', raw, prefs)).toMatchObject({ text, rawValue: raw, state: 'value' });
  });
  it('keeps byte-rate input in bytes per second and converts only the display interval', () => {
    const raw = 1048576 / 86400;
    expect(formatMetric('byteRate', raw, prefs, undefined, { byteRatePeriod: 'd' }))
      .toMatchObject({ text: '1.00 MB/d', rawValue: raw });
    expect(formatMetric('byteRate', 1024, prefs))
      .toMatchObject({ text: '1.00 KB/s', rawValue: 1024 });
    expect(formatMetric('byteRate', 0, prefs).text).toBe('0 B/s');
    expect(formatMetric('byteRate', -10, prefs).rawValue).toBe(-10);
    expect(formatMetric('byteRate', Number.MAX_VALUE, prefs, undefined, { byteRatePeriod: 'd' }).state)
      .toBe('invalid');
  });
  it('preserves fixed-millisecond and adaptive latency contracts from canonical seconds', () => {
    expect(formatMetric('latency', 0.05, prefs, undefined, { precision: 0 }))
      .toMatchObject({ text: '50 ms', rawValue: 0.05 });
    expect(formatMetric('latency', 2, prefs).text).toBe('2.00 s');
    expect(formatMetric('latency', 2, prefs, undefined, { latencyStyle: 'milliseconds', precision: 0 }).text)
      .toBe('2,000 ms');
    expect(formatMetric('latency', 0, prefs).text).toBe('0.00 ms');
    expect(formatMetric('latency', -1, prefs).state).toBe('invalid');
    expect(formatMetric('bytes', -1, prefs).state).toBe('invalid');
  });
  it('uses locale and precision for operational formats without changing vehicle unit preferences', () => {
    const local = { ...prefs, units: { ...prefs.units, locale: 'de-DE', precision: 3, duration: 'd' as const } };
    expect(formatMetric('bytes', 1536, local).text).toBe('1,500 KB');
    expect(formatMetric('latency', 0.05, local).text).toBe('50,000 ms');
    expect(formatMetric('bytes', null, local).state).toBe('missing');
    expect(local.units.duration).toBe('d');
  });
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
