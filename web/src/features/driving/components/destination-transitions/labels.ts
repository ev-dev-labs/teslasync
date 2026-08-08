import type { TFunction } from 'i18next';

import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DestinationEvidenceBand } from '../../lib/destinationTransitions';

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
  digits = 0,
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
    : fmtNumber(value, 0, locale);
}

export function destinationBits(
  value: number | null,
  locale: string,
): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : fmtNumber(value, 2, locale);
}

export function destinationLocalHour(
  hour: number,
  locale: string,
): string {
  const date = new Date(Date.UTC(2026, 0, 4, hour, 0));
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(date);
  }
}

export function destinationWeekday(
  weekday: number,
  locale: string,
): string {
  const date = new Date(Date.UTC(2026, 0, 4 + weekday, 12));
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    }).format(date);
  }
}

export function destinationMonth(
  observationMs: number,
  locale: string,
  timeZone: string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone,
    }).format(new Date(observationMs));
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(observationMs));
  }
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
