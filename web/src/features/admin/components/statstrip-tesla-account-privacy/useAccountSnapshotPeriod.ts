import { useTranslation } from 'react-i18next';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { StatPeriod } from '@/components/data-display';

export function useAccountSnapshotPeriod(fetchedAt: string | null): StatPeriod {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const observedAt = fetchedAt && Number.isFinite(Date.parse(fetchedAt)) ? fetchedAt : null;
  return {
    kind: 'snapshot',
    observedAt,
    label: observedAt
      ? t('teslaAccount.stats.syncedAt', 'Last synced: {{date}}', { date: formatDateTime(observedAt) })
      : t('teslaAccount.stats.notSynced', 'Not synced yet'),
    provenance: t('teslaAccount.stats.source', 'Latest Tesla account snapshot — not a date-range total'),
  };
}
