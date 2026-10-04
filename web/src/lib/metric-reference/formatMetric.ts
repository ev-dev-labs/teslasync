import { fmtNumber, getFormatterPreferences } from '@/lib/numberFormat';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import {
  convertDistanceFromSI, convertDistanceToSI, convertDurationFromSI,
  convertEfficiencyFromSI, convertEnergyFromSI, convertPowerFromSI,
  convertPressureFromSI, convertSpeedFromSI, convertTempFromSI,
} from '@/lib/unitConversion';
import { glossary, type MetricId } from './glossary';
import type { FormattedMetric, MetricPreferences, MetricRaw } from './types';

export function formatMetric(
  metricId: MetricId, raw: MetricRaw, prefs: MetricPreferences, missingReason?: string,
): FormattedMetric {
  const definition = glossary[metricId];
  if (!Object.prototype.hasOwnProperty.call(glossary, metricId)) throw new Error(`Unknown metric: ${metricId}`);
  const unavailable = (state: 'missing' | 'invalid', key: string, fallback: string): FormattedMetric => {
    const reason = missingReason || fallback;
    return { value: '—', unit: '', text: '—', state, reason,
      reasonKey: missingReason ? undefined : `developerReference.stats.reason.${key}`,
      accessibility: reason, rawValue: raw };
  };
  if (raw == null) return unavailable('missing', 'missing', 'No measurement supplied');
  const format = definition.format;
  if (format === 'text' || format === 'status') {
    if (typeof raw !== 'string' || !raw.trim())
      return unavailable('invalid', 'text', 'Expected non-empty source text');
    return { value: raw, unit: '', text: raw, state: 'value', accessibility: raw, rawValue: raw };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw))
    return unavailable('invalid', 'nonfinite', 'Expected a finite numeric measurement');
  const global = getFormatterPreferences();
  const requested = prefs.units.precision ?? global.precision;
  const precision = Number.isFinite(requested) && requested >= 0
    ? Math.min(20, Math.floor(requested)) : global.precision;
  const locale = prefs.units.locale ?? global.locale;
  const units = prefs.units;
  let display = Object.is(raw, -0) ? 0 : raw;
  let unit = '';
  switch (format) {
    case 'distance': display = convertDistanceFromSI(display, units.distance); unit = units.distance; break;
    case 'energy': display = convertEnergyFromSI(display, units.energy); unit = units.energy; break;
    case 'power': display = convertPowerFromSI(display, units.power); unit = units.power; break;
    case 'speed': display = convertSpeedFromSI(display, units.speed); unit = units.speed; break;
    case 'temperature': display = convertTempFromSI(display, units.temperature); unit = units.temperature; break;
    case 'pressure': display = convertPressureFromSI(display, units.pressure); unit = units.pressure; break;
    case 'duration': display = convertDurationFromSI(display, units.duration); unit = units.duration; break;
    case 'efficiency': {
      // Existing efficiency helper expects Wh/km. This is a display-boundary adaptation only.
      const whPerKm = display * convertDistanceToSI(1, 'km');
      display = units.distance === 'ft'
        ? display * convertDistanceToSI(1, 'ft')
        : convertEfficiencyFromSI(whPerKm, units.distance);
      display = convertEnergyFromSI(display, units.energy);
      unit = `${units.energy}/${units.distance}`;
      break;
    }
    case 'percent': unit = '%'; break;
    case 'score': unit = '/100'; break;
  }
  if (!Number.isFinite(display))
    return unavailable('invalid', 'overflow', 'Display conversion exceeded the finite numeric range');
  if (format === 'count' && (!Number.isSafeInteger(raw) || raw < 0))
    return unavailable('invalid', 'count', 'Expected a non-negative safe integer count');
  const digits = format === 'count' ? 0 : precision;
  // Suppress a display-rounded negative zero without changing the retained raw measurement.
  if (display < 0 && Math.abs(display) < 0.5 * 10 ** -digits) display = 0;
  let value = fmtNumber(display, digits, locale);
  if (format === 'currency') {
    if (prefs.currency.kind === 'iso') {
      try {
        value = formatCurrencyValue(display, prefs.currency.value, locale, digits, { useGrouping: true });
      } catch {
        value = formatCurrencyValue(display, prefs.currency.value, 'en-US', digits, { useGrouping: true });
      }
    } else value = `${prefs.currency.value}${value}`;
  }
  const separator = format === 'temperature' || format === 'percent' || format === 'score' ? '' : ' ';
  const text = unit ? `${value}${separator}${unit}` : value;
  return { value, unit, text, state: 'value', accessibility: text, rawValue: raw };
}
