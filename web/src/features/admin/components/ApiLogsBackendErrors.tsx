import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ErrorStats } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { Badge, Caption, Text } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import { PrefetchLink } from '@/components/layout';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ApiLogsRuntimeCard } from './ApiLogsRuntimeCard';
import { ApiLogsRuntimeList } from './ApiLogsRuntimeList';

interface ApiLogsBackendErrorsProps {
  data?: ErrorStats;
  state: DataState<ErrorStats>;
  loading: boolean;
  onRetry: () => unknown;
}

export function ApiLogsBackendErrors({ data, state, loading, onRetry }: ApiLogsBackendErrorsProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const rows = Object.entries(data?.by_code ?? {}).sort((a, b) => b[1].count - a[1].count);
  const title = t('apiLogs.backendErrors', 'Backend runtime errors');

  return (
    <ApiLogsRuntimeCard
      title={title}
      scope={t('apiLogs.backendScope', 'Since the current API process started; independent of API call filters.')}
      icon={AlertTriangle}
      count={data?.total_errors != null ? fmtInt(data.total_errors) : '—'}
      countLabel={t('apiLogs.runtime.recordedErrors', 'Recorded errors')}
      loading={loading && !data}
      context={
        <>
          <Caption className="block">{t('apiLogs.runtime.processUptime', 'Process uptime')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1 tabular-nums">{data?.uptime || '—'}</Text>
        </>
      }
    >
      <StaleRefreshWarning state={state} label={title} hideRetry />
      {loading && !data ? (
        <div role="status" aria-label={t('apiLogs.runtime.backendLoading', 'Loading backend error summary')}>
          <Skeleton className="h-16" />
        </div>
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={onRetry} />
      ) : !data ? (
        <Text as="p" variant="bodySm">{t('apiLogs.runtimeUnavailable', 'Backend runtime error summary unavailable.')}</Text>
      ) : rows.length > 0 ? (
        <>
          <Caption className="mb-2 block">{t('apiLogs.runtime.categories', 'Error categories · most frequent first')}</Caption>
          <ApiLogsRuntimeList label={t('apiLogs.runtime.backendCategories', 'Backend error categories')}>
            {rows.map(([code, entry]) => (
              <li key={code} className="border-t border-[var(--glass-border)] pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <Text as="p" variant="bodySm" mono className="min-w-0 break-words">{code}</Text>
                  <Badge variant="warning" size="sm" className="shrink-0">
                    {entry.count != null ? fmtInt(entry.count) : '—'}
                  </Badge>
                </div>
                <Text as="p" variant="bodySm" className="mt-1 break-words">{entry.last_message || '—'}</Text>
                <Caption className="mt-1 block">
                  {t('apiLogs.runtime.lastSeen', 'Last seen')}{' '}
                  {entry.last_seen ? <DateTime value={entry.last_seen} in="utc" /> : '—'}
                </Caption>
              </li>
            ))}
          </ApiLogsRuntimeList>
        </>
      ) : (
        <Text as="p" variant="bodySm">
          {data.total_errors === 0
            ? t('apiLogs.noRuntimeErrors', 'No backend runtime errors in this process.')
            : t('apiLogs.runtime.backendNoBreakdown', 'No error category breakdown is available for this process.')}
        </Text>
      )}
      <PrefetchLink
        to="/system-status"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Text variant="bodySm">{t('apiLogs.runtime.systemHealth', 'Inspect system health')}</Text>
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </PrefetchLink>
    </ApiLogsRuntimeCard>
  );
}
