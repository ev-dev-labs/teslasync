import type { TFunction } from 'i18next';

import {formatDateTime, formatTime} from '@/lib/dateFormat'
import {formatChartInstant} from '@/lib/dateConvert';
import type {
  DepartureDaypart,
  EvidenceBand,
} from '../../lib/departureForecast';

function departureInstant(ms: number | null | undefined): Date | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function departureClock(
  ms: number | null | undefined,
  locale: string,
  timeZone: string,
): string {
  return formatTime(departureInstant(ms), { locale, tz: timeZone });
}

export function departureDateTime(
  ms: number | null | undefined,
  locale: string,
  timeZone: string,
): string {
  return formatDateTime(departureInstant(ms), { locale, tz: timeZone });
}

export function departureChartLabel(
  ms: number | null | undefined,
  locale: string,
  timeZone: string,
): string {
  const date = departureInstant(ms);
  if (!date) return '—';
  return formatChartInstant(date, { locale, tz: timeZone });
}

/** Format an already-local abstract hour without applying a browser offset. */
export function departureLocalHour(hour: number, locale: string): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '—';
  return formatTime(new Date(Date.UTC(2020, 0, 1, hour, 0)), {
    locale,
    tz: 'UTC',
  });
}

export function relativeDepartureLabel(
  t: TFunction,
  minutesFromNow: number,
): string {
  const minutes = Math.max(1, Math.round(minutesFromNow));
  if (minutes < 60) {
    return t('departure.time.inMinutes', 'in {{count}} min', {
      count: minutes,
    });
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return t('departure.time.inHours', 'in {{count}} h', {
      count: hours,
    });
  }
  return t(
    'departure.time.inHoursMinutes',
    'in {{hours}} h {{minutes}} min',
    { hours, minutes: remainder },
  );
}

export function departureWeekdayLabel(
  t: TFunction,
  weekday: number,
): string {
  switch (weekday) {
    case 0:
      return t('departure.weekday.sun', 'Sunday');
    case 1:
      return t('departure.weekday.mon', 'Monday');
    case 2:
      return t('departure.weekday.tue', 'Tuesday');
    case 3:
      return t('departure.weekday.wed', 'Wednesday');
    case 4:
      return t('departure.weekday.thu', 'Thursday');
    case 5:
      return t('departure.weekday.fri', 'Friday');
    case 6:
      return t('departure.weekday.sat', 'Saturday');
    default:
      return t('departure.weekday.unknown', 'Unknown day');
  }
}

export function departureWeekdayShortLabel(
  t: TFunction,
  weekday: number,
): string {
  switch (weekday) {
    case 0:
      return t('departure.weekdayShort.sun', 'Sun');
    case 1:
      return t('departure.weekdayShort.mon', 'Mon');
    case 2:
      return t('departure.weekdayShort.tue', 'Tue');
    case 3:
      return t('departure.weekdayShort.wed', 'Wed');
    case 4:
      return t('departure.weekdayShort.thu', 'Thu');
    case 5:
      return t('departure.weekdayShort.fri', 'Fri');
    case 6:
      return t('departure.weekdayShort.sat', 'Sat');
    default:
      return t('departure.weekdayShort.unknown', 'Day');
  }
}

export function departureDaypartLabel(
  t: TFunction,
  daypart: DepartureDaypart,
): string {
  switch (daypart) {
    case 'overnight':
      return t('departure.daypart.overnight', 'Overnight');
    case 'morning':
      return t('departure.daypart.morning', 'Morning');
    case 'afternoon':
      return t('departure.daypart.afternoon', 'Afternoon');
    case 'evening':
      return t('departure.daypart.evening', 'Evening');
  }
}

export function departureEvidenceBandLabel(
  t: TFunction,
  band: EvidenceBand,
): string {
  switch (band) {
    case 'none':
      return t('departure.evidence.band.none', 'No evidence');
    case 'thin':
      return t('departure.evidence.band.thin', 'Thin evidence');
    case 'developing':
      return t('departure.evidence.band.developing', 'Developing evidence');
    case 'strong':
      return t('departure.evidence.band.strong', 'Stronger evidence');
  }
}
