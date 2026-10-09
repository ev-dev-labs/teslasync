import { describe, expect, it, vi } from 'vitest';
import { fmtNumber, formatBytes } from '@/lib/numberFormat';
import {
  formatMetric, glossary, type MetricDisplayOptions, type MetricId,
  type MetricPreferences, type MetricRaw,
} from './index';

const preferences: MetricPreferences = {
  units: {
    distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'bar',
    energy: 'Wh', duration: 'h', power: 'W', precision: 2, locale: 'en-US',
  },
  currency: { kind: 'symbol', value: '$' },
};

const specialistIds = [
  'bytes', 'byteRate', 'latency', 'mass', 'multiplier', 'rate', 'identifier',
] as const satisfies readonly MetricId[];

const rejectedRaw = [
  { name: 'absent', raw: undefined, state: 'missing' },
  { name: 'null', raw: null, state: 'missing' },
  { name: 'NaN', raw: NaN, state: 'invalid' },
  { name: 'positive infinity', raw: Infinity, state: 'invalid' },
  { name: 'negative infinity', raw: -Infinity, state: 'invalid' },
  { name: 'numeric source text', raw: '0', state: 'invalid' },
] as const satisfies readonly {
  name: string; raw: MetricRaw; state: 'missing' | 'invalid';
}[];

describe('specialist source display validation precedes callbacks', () => {
  describe.each(specialistIds)('%s callback gate', metricId => {
    it.each(rejectedRaw)('rejects $name without manufacturing a zero', ({ raw, state }) => {
      const formatter = vi.fn((value: number) => ({ value: String(value), unit: 'source' }));
      const result = formatMetric(metricId, raw, preferences, undefined, { formatter });
      expect(result).toMatchObject({ state, value: '—', text: '—', unit: '' });
      expect(Object.is(result.rawValue, raw)).toBe(true);
      expect(result.reason).toBeTruthy();
      expect(result.accessibility).toBe(result.reason);
      expect(formatter).not.toHaveBeenCalled();
    });

    it.each([0, -0])('passes a real zero %s unchanged rather than treating it as missing', raw => {
      const formatter = vi.fn((value: number) => ({ value: String(value), unit: '' }));
      const result = formatMetric(metricId, raw, preferences, undefined, { formatter });
      expect(result).toMatchObject({ state: 'value', value: '0', text: '0', unit: '' });
      expect(Object.is(result.rawValue, raw)).toBe(true);
      expect(formatter).toHaveBeenCalledExactlyOnceWith(raw, preferences);
      expect(Object.is(formatter.mock.calls[0]?.[0], raw)).toBe(true);
    });
  });

  it.each([
    { metricId: 'bytes', raw: -0.125, reason: 'bytes' },
    { metricId: 'latency', raw: -Number.MIN_VALUE, reason: 'latency' },
    { metricId: 'identifier', raw: -1, reason: 'identifier' },
    { metricId: 'identifier', raw: 0.125, reason: 'identifier' },
    { metricId: 'identifier', raw: Number.MAX_SAFE_INTEGER + 1, reason: 'identifier' },
    { metricId: 'count', raw: -1, reason: 'count' },
    { metricId: 'count', raw: 0.125, reason: 'count' },
    { metricId: 'count', raw: Number.MAX_SAFE_INTEGER + 1, reason: 'count' },
  ] as const)('rejects $metricId domain operand $raw before a source formatter', ({ metricId, raw, reason }) => {
    const formatter = vi.fn((value: number) => ({ value: fmtNumber(value), unit: '' }));
    expect(formatMetric(metricId, raw, preferences, undefined, { formatter })).toMatchObject({
      state: 'invalid', text: '—', unit: '', rawValue: raw,
      reasonKey: `developerReference.stats.reason.${reason}`,
    });
    expect(formatter).not.toHaveBeenCalled();
  });

  it.each([-1, 0.125, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'validates total %s even when a valid numerator has a specialist callback',
    countTotal => {
      const formatter = vi.fn((raw: number) => ({ value: `${raw}/${countTotal}`, unit: '' }));
      expect(formatMetric('count', 0, preferences, undefined, { countTotal, formatter })).toMatchObject({
        state: 'invalid', text: '—', rawValue: 0,
        reasonKey: 'developerReference.stats.reason.countTotal',
      });
      expect(formatter).not.toHaveBeenCalled();
    },
  );

  it('retains an explicit upstream reason when a specialist operand is rejected', () => {
    const formatter = vi.fn((raw: number) => ({ value: String(raw), unit: 'ms' }));
    expect(formatMetric('latency', -0.001, preferences, 'Clock observation was rejected', { formatter }))
      .toMatchObject({
        state: 'invalid', text: '—', rawValue: -0.001, reasonKey: undefined,
        reason: 'Clock observation was rejected', accessibility: 'Clock observation was rejected',
      });
    expect(formatter).not.toHaveBeenCalled();
  });
});

describe('continuous specialist operands are not identifiers or declared counts', () => {
  it.each([
    { metricId: 'bytes', raw: 0.125, text: '0.125 B' },
    { metricId: 'byteRate', raw: 0.125, text: '0.125 B/s' },
    { metricId: 'byteRate', raw: -0.125, text: '-0.125 B/s' },
    { metricId: 'latency', raw: 0.000125, text: '0.13 ms' },
    { metricId: 'mass', raw: 0.125, text: '0.13 kg' },
    { metricId: 'mass', raw: -0.125, text: '-0.13 kg' },
    { metricId: 'multiplier', raw: 0.125, text: '0.13×' },
    { metricId: 'multiplier', raw: -0.125, text: '-0.13×' },
    { metricId: 'rate', raw: -0.125, text: '-0.13' },
  ] as const)('retains fractional $metricId operand $raw under its registry meaning', ({ metricId, raw, text }) => {
    const result = formatMetric(metricId, raw, preferences);
    expect(result).toMatchObject({ state: 'value', text, rawValue: raw, accessibility: text });
  });

  it.each([
    { metricId: 'bytes', raw: 0.125 },
    { metricId: 'byteRate', raw: -0.125 },
    { metricId: 'latency', raw: 0.000125 },
    { metricId: 'mass', raw: -0.125 },
    { metricId: 'multiplier', raw: -0.125 },
    { metricId: 'rate', raw: -0.125 },
  ] as const)('passes valid continuous $metricId unchanged to a source formatter', ({ metricId, raw }) => {
    const formatter = vi.fn((value: number, prefs: MetricPreferences) => ({
      value: fmtNumber(value, prefs.units.precision, prefs.units.locale), unit: '',
    }));
    const result = formatMetric(metricId, raw, preferences, undefined, { formatter });
    expect(result).toMatchObject({ state: 'value', text: fmtNumber(raw, 2, 'en-US'), rawValue: raw });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(raw, preferences);
  });

  it('retains the largest safe identifier when source notation and locale would otherwise group it', () => {
    const local: MetricPreferences = {
      ...preferences, units: { ...preferences.units, locale: 'de-DE', precision: 6 },
    };
    const formatter = vi.fn((raw: number) => ({ value: `#${raw}`, unit: '' }));
    expect(formatMetric('identifier', Number.MAX_SAFE_INTEGER, local, undefined, {
      notation: 'compact', identifierPrefix: 'unused:', formatter,
    })).toMatchObject({
      state: 'value', text: '#9007199254740991', unit: '', rawValue: Number.MAX_SAFE_INTEGER,
    });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(Number.MAX_SAFE_INTEGER, local);
  });
});

describe('specialist source contracts preserve exact display and raw SI independently', () => {
  it('uses the real binary formatter once on daily bytes without replacing canonical bytes per second', () => {
    const raw = 1536 / 86400;
    const formatter = vi.fn((value: number, prefs: MetricPreferences) => ({
      value: formatBytes(value * 86400, {
        precision: prefs.units.precision, locale: prefs.units.locale,
      }),
      unit: '/d',
    }));
    expect(formatMetric('byteRate', raw, preferences, undefined, { byteRatePeriod: 'd', formatter }))
      .toMatchObject({ state: 'value', value: '1.50 KB', unit: '/d', text: '1.50 KB /d', rawValue: raw });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(raw, preferences);
    expect(raw).toBe(1536 / 86400);
  });

  it('preserves a valid byte zero as a source measurement rather than invoking an empty-byte convention', () => {
    const formatter = vi.fn((raw: number, prefs: MetricPreferences) => ({
      value: formatBytes(raw, { precision: prefs.units.precision, locale: prefs.units.locale }), unit: '',
    }));
    expect(formatMetric('bytes', 0, preferences, undefined, { formatter }))
      .toMatchObject({ state: 'value', value: '0 B', text: '0 B', rawValue: 0 });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(0, preferences);
  });

  it('retains an exact fixed-millisecond source display without a second seconds-to-milliseconds conversion', () => {
    const formatter = vi.fn<(raw: number, prefs: MetricPreferences) => { value: string; unit: string }>(() => ({
      value: '1,000.13', unit: 'ms',
    }));
    expect(formatMetric('latency', 1.000125, preferences, undefined, { latencyStyle: 'milliseconds', formatter }))
      .toMatchObject({ state: 'value', value: '1,000.13', unit: 'ms', text: '1,000.13 ms', rawValue: 1.000125 });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(1.000125, preferences);
  });

  it.each([
    { raw: 0.999999, text: '1,000.00 ms', unit: 'ms' },
    { raw: 1, text: '1.00 s', unit: 's' },
  ])('selects the adaptive latency interval before rounding $raw seconds', ({ raw, text, unit }) => {
    expect(formatMetric('latency', raw, preferences, undefined, { latencyStyle: 'adaptive' }))
      .toMatchObject({ state: 'value', text, unit, rawValue: raw });
  });

  it('keeps source-rate notation signed and exact even below display-rounding precision', () => {
    const raw = -0.000000125;
    const options: MetricDisplayOptions = { notation: 'source', unit: 'events/s', precision: 0 };
    expect(formatMetric('rate', raw, preferences, undefined, options))
      .toMatchObject({ state: 'value', value: '-1.25e-7', unit: 'events/s', text: '-1.25e-7 events/s', rawValue: raw });
    expect(formatMetric('rate', raw, preferences, undefined, { ...options, notation: undefined }))
      .toMatchObject({ state: 'value', text: '0 events/s', rawValue: raw });
  });

  it('passes merged display preferences to a specialist without mutating source preferences or options', () => {
    const options: MetricDisplayOptions = Object.freeze({
      units: Object.freeze({ locale: 'de-DE', precision: 4, duration: 's' as const }), precision: 3.9,
      formatter: vi.fn((raw: number, prefs: MetricPreferences) => ({
        value: fmtNumber(raw, prefs.units.precision, prefs.units.locale), unit: 'kg',
      })),
    });
    const before = structuredClone(preferences);
    const result = formatMetric('mass', 1234.56789, preferences, undefined, options);
    expect(result).toMatchObject({ text: '1.234,568 kg', rawValue: 1234.56789 });
    expect(options.formatter).toHaveBeenCalledExactlyOnceWith(1234.56789, {
      ...preferences, units: { ...preferences.units, locale: 'de-DE', precision: 3, duration: 's' },
    });
    expect(preferences).toEqual(before);
    expect(options.units).toEqual({ locale: 'de-DE', precision: 4, duration: 's' });
    expect(options.precision).toBe(3.9);
  });

  it('rejects a whitespace-only source formatter result without losing its numeric operand', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw === 1.25 ? ' \t\n' : String(raw), unit: 'kg' }));
    expect(formatMetric('mass', 1.25, preferences, undefined, { formatter })).toMatchObject({
      state: 'invalid', text: '—', unit: '', rawValue: 1.25,
      reasonKey: 'developerReference.stats.reason.formatter',
    });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(1.25, preferences);
  });
});

describe('specialist units cannot leak from another operand or turn a total into a percentage', () => {
  it('uses an explicitly declared source rate unit only on the operand that owns it', () => {
    expect(glossary.rate.inputUnit).toBe('source-defined');
    expect(formatMetric('rate', 0.125, preferences, undefined, { unit: 'events/s', countTotal: 100 }).text)
      .toBe('0.13 events/s');
    expect(formatMetric('rate', 0.125, preferences))
      .toMatchObject({ state: 'value', text: '0.13', unit: '', rawValue: 0.125 });
    expect(formatMetric('multiplier', 0.125, preferences, undefined, { unit: '%' }))
      .toMatchObject({ text: '0.13×', unit: '×', rawValue: 0.125 });
    expect(formatMetric('mass', 0.125, preferences, undefined, { unit: 'lb' }))
      .toMatchObject({ text: '0.13 kg', unit: 'kg', rawValue: 0.125 });
    expect(formatMetric('identifier', 12, preferences, undefined, { unit: '%', countTotal: 100 }))
      .toMatchObject({ text: '12', unit: '', rawValue: 12 });
  });

  it('keeps a zero numerator with a positive total exact despite source, precision and rate-unit options', () => {
    expect(formatMetric('count', 0, preferences, undefined, {
      countTotal: 1500, precision: 9, notation: 'source', unit: '%',
    })).toMatchObject({ state: 'value', value: '0/1,500', text: '0/1,500', unit: '', rawValue: 0 });
  });

  it('permits a validated source count/total callback without passing it a ratio instead of the numerator', () => {
    const countTotal = 1500;
    const formatter = vi.fn((raw: number, prefs: MetricPreferences) => ({
      value: `${fmtNumber(raw, 0, prefs.units.locale)}/${fmtNumber(countTotal, 0, prefs.units.locale)}`, unit: '',
    }));
    expect(formatMetric('count', 1250, preferences, undefined, { countTotal, formatter }))
      .toMatchObject({ state: 'value', text: '1,250/1,500', rawValue: 1250, unit: '' });
    expect(formatter).toHaveBeenCalledExactlyOnceWith(1250, preferences);
    expect(countTotal).toBe(1500);
  });
});

describe('rounded-duration specialist callbacks retain the declared non-negative display domain', () => {
  it('rejects a negative rounded-minute operand before the specialist formatter can render it', () => {
    const raw = -0.125;
    const formatter = vi.fn((value: number, prefs: MetricPreferences) => ({
      value: fmtNumber(value / 60, prefs.units.precision, prefs.units.locale), unit: 'min',
    }));
    expect(formatMetric('duration', raw, preferences, undefined, { durationStyle: 'roundedMinutes' }))
      .toMatchObject({ state: 'invalid', text: '—', rawValue: raw });
    expect(formatMetric('duration', raw, preferences, undefined, { durationStyle: 'roundedMinutes', formatter }))
      .toMatchObject({
        state: 'invalid', text: '—', rawValue: raw,
        reasonKey: 'developerReference.stats.reason.duration',
      });
    expect(formatter).not.toHaveBeenCalled();
  });
});
