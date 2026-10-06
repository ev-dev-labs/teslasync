import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { DataFreshness, DataProvenanceBadge, OperationalBrief } from '@/components/data-display';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';

interface TripOperationalBriefProps extends Omit<OperationalBriefProps, 'statusLabel' | 'statusTone' | 'loading' | 'compact' | 'freshness'> {
  source: DataState<unknown>;
  loading?: boolean;
}

export function TripOperationalBrief({ source, loading, ...props }: TripOperationalBriefProps) {
  const { t } = useTranslation();
  const labels = {
    initial: t('trips.brief.status.initial', 'Loading source'),
    initialFailure: t('trips.brief.status.initialFailure', 'Source failed'),
    ok: t('trips.brief.status.ok', 'Source loaded'),
    stale: t('trips.brief.status.stale', 'Retained source'),
    partial: t('trips.brief.status.partial', 'Partial source'),
    unavailable: t('trips.brief.status.unavailable', 'Source unavailable'),
  };
  return (
    <OperationalBrief
      {...props}
      compact
      loading={loading ?? source.status === 'initial'}
      statusLabel={labels[source.status]}
      statusTone={source.fatalError ? 'danger' : source.status === 'stale' || source.status === 'partial' ? 'warning' : 'neutral'}
      freshness={<>
        <DataProvenanceBadge provenance={source.provenance} status={source.status} updatedAt={source.updatedAt} />
        <DataFreshness updatedAt={source.updatedAt} isFetching={source.isRefreshing}
          isStale={source.status === 'stale'} isError={source.refreshError !== null || source.fatalError !== null} />
      </>}
    />
  );
}
