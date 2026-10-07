import type { TFunction } from 'i18next';
import type { DataStatus } from '@/api/dataState';

const STATUS_LABELS: Record<DataStatus, string> = {
  initial: 'Loading source', ok: 'Snapshot loaded', stale: 'Retained source data',
  partial: 'Partial source data', unavailable: 'No source data', initialFailure: 'Source unavailable',
};

export function sourceStatus(status: DataStatus, t: TFunction): string {
  return t(`operationalSource.status.${status}`, STATUS_LABELS[status]);
}

export function sourceFreshness(updatedAt: number | null, t: TFunction): string {
  return updatedAt != null
    ? t('operationalSource.fetchedAt', 'Fetched {{time}}', { time: new Date(updatedAt).toLocaleString() })
    : t('operationalSource.unknownFreshness', 'Fetch time not supplied');
}
