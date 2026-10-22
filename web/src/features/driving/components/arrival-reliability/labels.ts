import type { TFunction } from 'i18next';

import type { ArrivalEvidenceBand } from '../../lib/arrivalReliability';
import {formatMonthYear, formatWeekdayName} from '@/lib/dateConvert'
import {formatHourName} from '@/lib/dateConvert';
import { getGlobalPrecision } from '@/lib/numberFormat';

export function arrivalEvidenceBandLabel(
  t: TFunction,
  band: ArrivalEvidenceBand,
): string {
  switch (band) {
    case 'thin':
      return t('arrivalReliability.bands.thin', 'Thin support');
    case 'developing':
      return t('arrivalReliability.bands.developing', 'Developing support');
    case 'strong':
      return t('arrivalReliability.bands.strong', 'Strong support');
    default:
      return t('arrivalReliability.bands.none', 'No support');
  }
}

export function arrivalPercent(
  value: number | null,
  locale: string,
  digits = getGlobalPrecision(),
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value * 100)}%`;
  } catch {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value * 100)}%`;
  }
}

export function arrivalIndex(
  value: number | null,
  locale: string,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: getGlobalPrecision(),
      maximumFractionDigits: getGlobalPrecision(),
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: getGlobalPrecision(),
      maximumFractionDigits: getGlobalPrecision(),
    }).format(value);
  }
}

export function arrivalLocalHour(hour: number, locale: string): string {
  // Wrap out-of-range buckets onto the 24h dial like the old UTC anchor did.
  const wrapped = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : NaN;
  return formatHourName(wrapped, { locale, showMinutes: true });
}

export function arrivalWeekday(weekday: number, locale: string): string {
  const date = new Date(Date.UTC(2026, 0, 4 + weekday, 12));
  return formatWeekdayName(date, { locale, tz: 'UTC', weekdayStyle: 'long' });
}

export function arrivalMonth(
  observationMs: number,
  locale: string,
  timeZone: string,
): string {
  return formatMonthYear(new Date(observationMs), { locale, tz: timeZone });
}
