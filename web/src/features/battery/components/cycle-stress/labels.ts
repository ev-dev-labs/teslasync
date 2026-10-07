import type { TFunction } from 'i18next';

import type {
  CycleDurationBand,
  CycleEvidenceBand,
  CycleSource,
} from '../../lib/cycleStress';

export function cycleStressNumber(
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

export function cycleStressPercent(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  if (value == null) return '—';
  return `${cycleStressNumber(value, locale, precision)}%`;
}

export function cycleStressShare(
  value: number | null | undefined,
  locale: string,
  precision = 1,
): string {
  return value == null
    ? '—'
    : cycleStressPercent(value * 100, locale, precision);
}

export function cycleStressMonthLabel(
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

export function cycleStressBandLabel(
  t: TFunction,
  band: CycleEvidenceBand,
): string {
  switch (band) {
    case 'strong':
      return t('cycleStress.bands.strong', 'Strong');
    case 'developing':
      return t('cycleStress.bands.developing', 'Developing');
    case 'thin':
      return t('cycleStress.bands.thin', 'Thin');
    default:
      return t('cycleStress.bands.none', 'No evidence');
  }
}

export function cycleStressSourceLabel(
  t: TFunction,
  source: CycleSource,
): string {
  return source === 'drive'
    ? t('cycleStress.sources.drives', 'Drive history')
    : t('cycleStress.sources.charging', 'Charging history');
}

export function cycleStressDurationBandLabel(
  t: TFunction,
  band: CycleDurationBand,
): string {
  switch (band) {
    case 'under_day':
      return t('cycleStress.duration.underDay', 'Under 1 day');
    case 'one_to_three_days':
      return t('cycleStress.duration.oneToThree', '1-3 days');
    case 'three_to_seven_days':
      return t('cycleStress.duration.threeToSeven', '3-7 days');
    default:
      return t('cycleStress.duration.sevenPlus', '7+ days');
  }
}
