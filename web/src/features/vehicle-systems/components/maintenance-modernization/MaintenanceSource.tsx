import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { SourceContent } from '@/components/layout';
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
  const unavailable = !enabled || source.isRefreshBlocked;
  const retained = source.refreshError != null || (source.hasData && source.isRefreshBlocked);
  return (
    <div data-maintenance-retained={source.refreshError ? '' : undefined}>
      <SourceContent
        state={source.fatalError ? 'error' : !source.hasData ? unavailable ? 'empty' : 'loading'
          : source.data == null ? 'empty' : retained ? 'retained' : 'ready'}
        label={t('maintenance.title', 'Maintenance')}
        error={source.fatalError}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        emptyMessage={t('common.noData', 'No data available')}
        emptyContent={!source.hasData ? <Text as="p" variant="bodySm">{t('common.noData', 'No data available')}</Text> : empty}
        loadingContent={loading}
        retainedMessage={source.refreshError
          ? t('developerReference.stats.state.retained', 'Showing retained measurements')
          : t('maintenance.sources.refreshBlocked', 'Refresh is paused. Retained data remains available.')}
        errorRecovery={{ onRetry: source.retry ?? undefined }}
      >
      {source.isRefreshBlocked && source.refreshError && (
        <Text as="p" variant="bodySm" role="status">
          {t('maintenance.sources.refreshBlocked', 'Refresh is paused. Retained data remains available.')}
        </Text>
      )}
        {children}
      </SourceContent>
    </div>
  );
}
