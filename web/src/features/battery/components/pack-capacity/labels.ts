import type { TFunction } from 'i18next';

import type {
  CapacityFitStatus,
  PackCapacityEvidenceBand,
} from '../../lib/packCapacity';

export function packCapacityNumber(
  value: number | null | undefined,
  locale: string,
  maximumFractionDigits = 1,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value);
}

export function packCapacityPercent(
  share: number | null | undefined,
  locale: string,
  maximumFractionDigits = 1,
): string {
  if (share == null || !Number.isFinite(share)) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits,
  }).format(share);
}

export function packCapacityMonthLabel(
  monthKey: string,
  locale: string,
): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function packCapacityBandLabel(
  t: TFunction,
  band: PackCapacityEvidenceBand,
): string {
  const labels: Record<PackCapacityEvidenceBand, string> = {
    none: t('packCapacity.bands.none', 'No support'),
    thin: t('packCapacity.bands.thin', 'Thin support'),
    developing: t(
      'packCapacity.bands.developing',
      'Developing support',
    ),
    strong: t('packCapacity.bands.strong', 'Strong support'),
  };
  return labels[band];
}

export function packCapacityFitLabel(
  t: TFunction,
  status: CapacityFitStatus,
): string {
  const labels: Record<CapacityFitStatus, string> = {
    available: t('packCapacity.fit.available', 'Available'),
    insufficient_observations: t(
      'packCapacity.fit.insufficientObservations',
      'Needs at least 12 measurements',
    ),
    insufficient_span: t(
      'packCapacity.fit.insufficientSpan',
      'Needs at least 180 days',
    ),
    insufficient_months: t(
      'packCapacity.fit.insufficientMonths',
      'Needs at least 6 active months',
    ),
  };
  return labels[status];
}
