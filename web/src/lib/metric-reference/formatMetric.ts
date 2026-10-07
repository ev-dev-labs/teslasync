import { fmtCompact, fmtNumber, formatBytes, getFormatterPreferences } from '@/lib/numberFormat';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import {
  convertDistanceFromSI, convertDistanceToSI, convertDurationFromSI,
  convertEfficiencyFromSI, convertEnergyFromSI, convertPowerFromSI,
  convertPressureFromSI, convertSpeedFromSI, convertTempFromSI,
} from '@/lib/unitConversion';
import { glossary, type MetricId } from './glossary';
import type { FormattedMetric, MetricPreferences, MetricRaw, MetricDisplayOptions } from './types';

export function formatMetric(
  metricId: MetricId, raw: MetricRaw, prefs: MetricPreferences, missingReason?: string,
  options?: MetricDisplayOptions,
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
  const measurement = (value: string, unit = ''): FormattedMetric => {
    const separator = ['temperature', 'percent', 'score', 'multiplier'].includes(format) ? '' : ' ';
    const text = unit ? `${value}${separator}${unit}` : value;
    return { value, unit, text, state: 'value', accessibility: text, rawValue: raw };
  };
  if (format === 'text' || format === 'status') {
    if (typeof raw !== 'string' || !raw.trim())
      return unavailable('invalid', 'text', 'Expected non-empty source text');
    return { value: raw, unit: '', text: raw, state: 'value', accessibility: raw, rawValue: raw };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw))
    return unavailable('invalid', 'nonfinite', 'Expected a finite numeric measurement');
  const global = getFormatterPreferences();
  const units = { ...prefs.units, ...options?.units };
  const requested = options?.precision ?? units.precision ?? global.precision;
  const precision = Number.isFinite(requested) && requested >= 0
    ? Math.min(20, Math.floor(requested)) : global.precision;
  const locale = units.locale ?? global.locale;
  if (format === 'count' && (!Number.isSafeInteger(raw) || raw < 0))
    return unavailable('invalid', 'count', 'Expected a non-negative safe integer count');
  if (format === 'identifier' && (!Number.isSafeInteger(raw) || raw < 0))
    return unavailable('invalid', 'identifier', 'Expected a non-negative safe integer identifier');
  if (format === 'bytes' && raw < 0)
    return unavailable('invalid', 'bytes', 'Expected a non-negative byte count');
  if (format === 'latency' && raw < 0)
    return unavailable('invalid', 'latency', 'Expected a non-negative latency');
  if (format === 'duration' && options?.durationStyle === 'roundedMinutes' && raw < 0)
    return unavailable('invalid', 'duration', 'Expected a non-negative duration for this display');
  if (format === 'count' && options?.countTotal !== undefined
    && (!Number.isSafeInteger(options.countTotal) || options.countTotal < 0))
    return unavailable('invalid', 'countTotal', 'Expected a non-negative safe integer total');
  if (options?.formatter) {
    const formatted = options.formatter(raw, { ...prefs, units: { ...units, precision, locale } });
    if (!formatted.value.trim())
      return unavailable('invalid', 'formatter', 'Expected a non-empty formatted measurement');
    return measurement(formatted.value, formatted.unit);
  }
  if (format === 'identifier') return measurement(`${options?.identifierPrefix ?? ''}${raw}`);
  let display = Object.is(raw, -0) ? 0 : raw;
  let unit = '';
  if (format === 'bytes' || format === 'byteRate') {
    const interval = options?.byteRatePeriod ?? 's';
    if (format === 'byteRate' && interval === 'd') display *= 86400;
    if (!Number.isFinite(display))
      return unavailable('invalid', 'overflow', 'Display conversion exceeded the finite numeric range');
    const formatted = formatBytes(display, { precision, locale });
    const separator = formatted.lastIndexOf(' ');
    const value = formatted.slice(0, separator);
    unit = formatted.slice(separator + 1);
    if (format === 'byteRate') unit += `/${interval}`;
    return measurement(value, unit);
  }
  switch (format) {
    case 'distance': display = convertDistanceFromSI(display, units.distance); unit = units.distance; break;
    case 'energy': display = convertEnergyFromSI(display, units.energy); unit = units.energy; break;
    case 'power': display = convertPowerFromSI(display, units.power); unit = units.power; break;
    case 'speed': display = convertSpeedFromSI(display, units.speed); unit = units.speed; break;
    case 'temperature': display = convertTempFromSI(display, units.temperature); unit = units.temperature; break;
    case 'pressure': display = convertPressureFromSI(display, units.pressure); unit = units.pressure; break;
    case 'duration': display = convertDurationFromSI(display, units.duration); unit = units.duration; break;
    case 'latency': {
      const milliseconds = options?.latencyStyle === 'milliseconds' || display < 1;
      if (milliseconds) display *= 1000;
      unit = milliseconds ? 'ms' : 's';
      break;
    }
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
    case 'mass': unit = 'kg'; break;
    case 'multiplier': unit = '×'; break;
    case 'rate': unit = options?.unit ?? ''; break;
  }
  if (!Number.isFinite(display))
    return unavailable('invalid', 'overflow', 'Display conversion exceeded the finite numeric range');
  if (format === 'count' && options?.countTotal !== undefined) {
    const total = options.countTotal;
    const value = `${fmtNumber(display, 0, locale)}/${fmtNumber(total, 0, locale)}`;
    return measurement(value);
  }
  if (format === 'duration' && options?.durationStyle === 'roundedMinutes') {
    const value = formatDurationMinutes(convertDurationFromSI(raw, 'min'));
    return { value, unit: '', text: value, state: 'value', accessibility: value, rawValue: raw };
  }
  const digits = format === 'count' ? 0 : precision;
  // Suppress a display-rounded negative zero without changing the retained raw measurement.
  const roundedDigits = options?.notation === 'compact'
    && Math.abs(display) < (options.compactThreshold ?? 10000) ? 0 : digits;
  if (options?.notation !== 'source' && display < 0 && Math.abs(display) < 0.5 * 10 ** -roundedDigits) display = 0;
  let value = options?.notation === 'source' ? String(display) : options?.notation === 'compact'
    ? fmtCompact(display, options.compactThreshold)
    : fmtNumber(display, digits, locale);
  if (format === 'currency') {
    if (prefs.currency.kind === 'iso') {
      try {
        value = formatCurrencyValue(display, prefs.currency.value, locale, digits, { useGrouping: true });
      } catch {
        value = formatCurrencyValue(display, prefs.currency.value, 'en-US', digits, { useGrouping: true });
      }
    } else value = `${prefs.currency.value}${value}`;
  }
  return measurement(value, unit);
}
