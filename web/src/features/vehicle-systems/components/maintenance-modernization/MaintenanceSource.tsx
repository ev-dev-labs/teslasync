import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { QueryError, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';

export interface MaintenanceSourceProps<T> {
  source: DataState<T>;
  enabled: boolean;
  children: ReactNode;
  empty: ReactNode;
  loading?: ReactNode;
}

/** One source's failure cannot replace a neighbor or its own retained data.
 * Shared DataState owns the state decision; this component only presents it. */
export function MaintenanceSource<T>({
  source,
  enabled,
  children,
  empty,
  loading,
}: MaintenanceSourceProps<T>) {
  const { t } = useTranslation();
  if (source.fatalError) {
    return <QueryError error={source.fatalError} onRetry={source.retry ?? undefined} />;
  }
  if (!source.hasData) {
    if (!enabled || source.isRefreshBlocked) {
      return <Text as="p" variant="bodySm">{t('common.noData', 'No data available')}</Text>;
    }
    return loading ?? <Skeleton className="h-32 w-full rounded-xl" />;
  }
  return (
    <>
      {source.refreshError && (
        <div data-maintenance-retained>
          <Text as="p" variant="bodySm" role="status">
            {t('developerReference.stats.state.retained', 'Showing retained measurements')}
          </Text>
          <QueryError error={source.refreshError} onRetry={source.retry ?? undefined} />
        </div>
      )}
      {source.isRefreshBlocked && (
        <Text as="p" variant="bodySm" role="status">
          {t('maintenance.sources.refreshBlocked', 'Refresh is paused. Retained data remains available.')}
        </Text>
      )}
      {source.data == null ? empty : children}
    </>
  );
}
