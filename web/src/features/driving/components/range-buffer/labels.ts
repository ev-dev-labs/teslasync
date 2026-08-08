import type { TFunction } from 'i18next';

import type { RangeBufferEvidenceBand } from '../../lib/rangeBuffer';

export function rangeBufferNumber(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

export function rangeBufferPercent(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${rangeBufferNumber(value, locale, precision)}%`;
}

export function rangeBufferShare(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  return value == null
    ? '—'
    : rangeBufferPercent(value * 100, locale, precision);
}

export function rangeBufferBandLabel(
  t: TFunction,
  band: RangeBufferEvidenceBand,
): string {
  switch (band) {
    case 'strong':
      return t('rangeBuffer.bands.strong', 'Strong');
    case 'developing':
      return t('rangeBuffer.bands.developing', 'Developing');
    case 'thin':
      return t('rangeBuffer.bands.thin', 'Thin');
    default:
      return t('rangeBuffer.bands.none', 'No evidence');
  }
}

export function rangeBufferWeekdayLabel(
  t: TFunction,
  weekday: number,
): string {
  const labels = [
    t('rangeBuffer.weekdays.mon', 'Mon'),
    t('rangeBuffer.weekdays.tue', 'Tue'),
    t('rangeBuffer.weekdays.wed', 'Wed'),
    t('rangeBuffer.weekdays.thu', 'Thu'),
    t('rangeBuffer.weekdays.fri', 'Fri'),
    t('rangeBuffer.weekdays.sat', 'Sat'),
    t('rangeBuffer.weekdays.sun', 'Sun'),
  ];
  return labels[weekday] ?? '—';
}

export function rangeBufferHourLabel(bucketStartHour: number): string {
  const start = String(bucketStartHour).padStart(2, '0');
  const end = String(bucketStartHour + 4).padStart(2, '0');
  return `${start}:00-${end}:00`;
}

export function rangeBufferMonthLabel(
  monthKey: string,
  locale: string,
): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(
    new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12),
    ),
  );
}
