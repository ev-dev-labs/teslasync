import { afterEach, describe, expect, it } from 'vitest';
import { formatMetric, type MetricPreferences } from '@/lib/metric-reference';
import { fmtCompact, fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import {
  energyDisplay, minuteDisplay, powerDisplay, kwhToCanonicalWh,
  minutesToCanonicalSeconds, kwToCanonicalWatts, kmToCanonicalMeters,
} from './displayBoundary';

const prefs: MetricPreferences = {
  units: { distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
    energy: 'Wh', duration: 'h', power: 'W', precision: 3, locale: 'en-US' },
  currency: { kind: 'symbol', value: '$' },
};
const initial = getFormatterPreferences();
afterEach(() => { setGlobalLocale(initial.locale); setGlobalPrecision(initial.precision); });

describe('charging producer/display boundary compatibility, not calculation changes', () => {
  it.each([0, -0, 0.0001, 0.499, 0.5, 1.234567, 59.5, 99.995, -1.25, 1234567.89])(
    'bridges declared local units for %s without guessing source labels', value => {
      const energy = formatMetric('energy', kwhToCanonicalWh(value), prefs, undefined, energyDisplay);
      expect(energy.value).toBe(fmtNumber(Object.is(value, -0) ? 0 : value, 3, 'en-US'));
      expect(energy.unit).toBe('kWh');
      expect(kwhToCanonicalWh(1)).toBe(1000);
      expect(kwToCanonicalWatts(1)).toBe(1000);
      expect(minutesToCanonicalSeconds(1)).toBe(60);
      expect(kmToCanonicalMeters(1)).toBe(1000);
      const power = formatMetric('power', kwToCanonicalWatts(value), prefs, undefined, powerDisplay);
      const duration = formatMetric('duration', minutesToCanonicalSeconds(value), prefs, undefined, minuteDisplay);
      expect(power.unit).toBe('kW');
      expect(duration.unit).toBe('min');
      expect(power.value).toBe(fmtNumber(Object.is(value, -0) ? 0 : value, 3, 'en-US'));
      expect(duration.value).toBe(fmtNumber(Object.is(value, -0) ? 0 : value, 3, 'en-US'));
    },
  );
  it.each([0, 0.1, 0.5, 59.49, 59.5, 59.999, 60, 119.5, 149.5, 2400.4])(
    'delegates existing rounded-minute behavior exactly for %s min', minutes => {
      expect(formatMetric('charge.avgDuration', minutesToCanonicalSeconds(minutes), prefs,
        undefined, { durationStyle: 'roundedMinutes' }).text).toBe(formatDurationMinutes(minutes));
    },
  );
  it.each([0, 2, 5])('keeps existing numeric-minute precision %s rather than humanizing lifetime averages', precision => {
    const source = 59.87654;
    const selected = { ...prefs, units: { ...prefs.units, precision } };
    expect(formatMetric('duration', minutesToCanonicalSeconds(source), selected, undefined, minuteDisplay).text)
      .toBe(`${fmtNumber(source, precision, 'en-US')} min`);
    expect(formatMetric('energy', 850, selected).unit).toBe('Wh');
    expect(formatMetric('duration', 3600, selected).unit).toBe('h');
  });
  it.each(['en-US', 'de-DE', 'fr-FR'])('preserves existing compact locale and threshold behavior for %s', locale => {
    setGlobalLocale(locale);
    for (const value of [0, 9999.49, 9999.5, 10000, 1234567]) {
      const raw = kwhToCanonicalWh(value);
      expect(formatMetric('energy', raw, prefs, undefined,
        { ...energyDisplay, notation: 'compact', compactThreshold: 10000 }).value).toBe(fmtCompact(value, 10000));
    }
  });
  it('keeps absent/nonfinite source fields explicit and meaningful zero distinct', () => {
    for (const bridge of [kwhToCanonicalWh, minutesToCanonicalSeconds, kwToCanonicalWatts, kmToCanonicalMeters]) {
      expect(bridge(null)).toBeNull();
      expect(bridge(undefined)).toBeNull();
      expect(Number.isNaN(bridge(NaN))).toBe(true);
      expect(bridge(Infinity)).toBe(Infinity);
    }
    expect(formatMetric('duration', -1, prefs, undefined, { durationStyle: 'roundedMinutes' }))
      .toMatchObject({ state: 'invalid', reasonKey: 'developerReference.stats.reason.duration', rawValue: -1 });
    expect(formatMetric('energy', kwhToCanonicalWh(null), prefs, undefined, energyDisplay).state).toBe('missing');
    expect(formatMetric('energy', kwhToCanonicalWh(NaN), prefs, undefined, energyDisplay).state).toBe('invalid');
    expect(formatMetric('energy', kwhToCanonicalWh(0), prefs, undefined, energyDisplay).state).toBe('value');
  });
  it('does not mutate preferences and suppresses display-rounded signed zero without replacing the source', () => {
    const units = Object.freeze({ ...prefs.units });
    const preferences = Object.freeze({ ...prefs, units });
    const original = JSON.stringify(preferences);
    const raw = -0.25;
    const result = formatMetric('energy', raw, preferences, undefined,
      { units: { energy: 'Wh' }, notation: 'compact' });
    expect(result.value).toBe('0');
    expect(result.rawValue).toBe(raw);
    formatMetric('duration', 3600, preferences, undefined, minuteDisplay);
    expect(JSON.stringify(preferences)).toBe(original);
  });
  it('does not conflate percentage, ratio, declared count or recorded currency', () => {
    expect(formatMetric('percent', 0.5, prefs).text).toBe('0.500%');
    expect(formatMetric('ratio', 0.5, prefs).text).toBe('0.500');
    expect(formatMetric('count', 0.5, prefs).state).toBe('invalid');
    expect(formatMetric('currency', -1.25, prefs).text).toBe('$-1.250');
  });
  it.each([0, -0, 850, -2000, 12125, 1e12])('keeps the original Delta display-unit operands numerically for SI %s', raw => {
    expect(convertEnergyFromSI(raw, 'kWh')).toBe(raw / 1000);
    expect(convertPowerFromSI(raw, 'kW')).toBe(raw / 1000);
  });
  it('never coerces numeric-looking source text into a physical measurement at the display boundary', () => {
    const source = '1.25' as unknown as number;
    for (const bridge of [kwhToCanonicalWh, minutesToCanonicalSeconds, kwToCanonicalWatts, kmToCanonicalMeters]) {
      expect(bridge(source)).toBe('1.25');
    }
    expect(formatMetric('energy', kwhToCanonicalWh(source), prefs))
      .toMatchObject({ state: 'invalid', rawValue: '1.25' });
  });
});
