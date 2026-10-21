import type { TFunction } from 'i18next';

import { formatMonthName, formatMonthYear } from '@/lib/dateFormat';

const WEEKDAYS = [
  ['sun', 'Sun', 'Sunday'],
  ['mon', 'Mon', 'Monday'],
  ['tue', 'Tue', 'Tuesday'],
  ['wed', 'Wed', 'Wednesday'],
  ['thu', 'Thu', 'Thursday'],
  ['fri', 'Fri', 'Friday'],
  ['sat', 'Sat', 'Saturday'],
] as const;

export function getWeekdayLabels(t: TFunction, long = false): string[] {
  return WEEKDAYS.map(([key, shortLabel, longLabel]) =>
    long
      ? t(`driveCalendar.weekdays.${key}.long`, longLabel)
      : t(`driveCalendar.weekdays.${key}.short`, shortLabel),
  );
}

export function formatCalendarMonth(
  monthKey: string,
  locale?: string,
  includeYear = false,
): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return '—';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return '—';

  return includeYear
    ? formatMonthYear(monthKey, { locale, yearStyle: '2-digit' })
    : formatMonthName(monthKey, { locale });
}
