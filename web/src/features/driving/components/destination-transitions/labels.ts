import type { TFunction } from 'i18next';

import { formatDateTime, formatHourName, formatMonthYear, formatWeekdayName } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DestinationEvidenceBand } from '../../lib/destinationTransitions';
import { getGlobalPrecision } from '@/lib/numberFormat';

export function destinationEvidenceBandLabel(
  t: TFunction,
  band: DestinationEvidenceBand,
): string {
  switch (band) {
    case 'thin':
      return t('destinationTransitions.bands.thin', 'Thin evidence');
    case 'developing':
      return t(
        'destinationTransitions.bands.developing',
        'Developing evidence',
      );
    case 'strong':
      return t('destinationTransitions.bands.strong', 'Strong evidence');
    default:
      return t('destinationTransitions.bands.none', 'No evidence');
  }
}

export function destinationPercent(
  value: number | null,
  locale: string,
  digits = getGlobalPrecision(),
): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${fmtNumber(value * 100, digits, locale)}%`;
}

export function destinationIndex(
  value: number | null,
  locale: string,
): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : fmtNumber(value, undefined, locale);
}

export function destinationBits(
  value: number | null,
  locale: string,
): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : fmtNumber(value, undefined, locale);
}

export function destinationLocalHour(
  hour: number,
  locale: string,
): string {
  // Wrap out-of-range buckets onto the 24h dial like the old UTC anchor did.
  const wrapped = Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : NaN;
  return formatHourName(wrapped, { locale, showMinutes: true });
}

export function destinationWeekday(
  weekday: number,
  locale: string,
): string {
  const date = new Date(Date.UTC(2026, 0, 4 + weekday, 12));
  return formatWeekdayName(date, { locale, tz: 'UTC', weekdayStyle: 'long' });
}

export function destinationMonth(
  observationMs: number,
  locale: string,
  timeZone: string,
): string {
  return formatMonthYear(new Date(observationMs), { locale, tz: timeZone });
}

export function destinationDateTime(
  value: number | null,
  locale: string,
  timeZone: string,
): string {
  return value != null
    ? formatDateTime(new Date(value), { locale, tz: timeZone })
    : '—';
}
