import type { TFunction } from 'i18next';

import type { ArrivalEvidenceBand } from '../../lib/arrivalReliability';

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
  digits = 0,
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
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(value);
  }
}

export function arrivalLocalHour(hour: number, locale: string): string {
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

export function arrivalWeekday(weekday: number, locale: string): string {
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

export function arrivalMonth(
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
