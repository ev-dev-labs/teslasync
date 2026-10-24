import type { TFunction } from 'i18next';
import type { DataStatus } from '@/api/dataState';
import type { DateFormatter } from '@/hooks/useDateFormat';
import { formatDateTime as formatDateTimeShared } from '@/lib/dateFormat';

const STATUS_LABELS: Record<DataStatus, string> = {
  initial: 'Loading source', ok: 'Snapshot loaded', stale: 'Retained source data',
  partial: 'Partial source data', unavailable: 'No source data', initialFailure: 'Source unavailable',
};

export function sourceStatus(status: DataStatus, t: TFunction): string {
  return t(`operationalSource.status.${status}`, STATUS_LABELS[status]);
}

export function sourceFreshness(updatedAt: number | null, t: TFunction, formatDateTime?: DateFormatter): string {
  const date = updatedAt != null ? new Date(updatedAt) : null;
  return date != null && Number.isFinite(date.getTime())
    ? t('operationalSource.fetchedAt', 'Fetched {{time}}', {
      time: formatDateTime ? formatDateTime(date) : formatDateTimeShared(date),
    })
    : t('operationalSource.unknownFreshness', 'Fetch time not supplied');
}
