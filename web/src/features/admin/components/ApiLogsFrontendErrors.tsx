import { Bug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWebErrorsSummary } from '@/api/hooks/useAdmin';
import { Badge, Caption, Text } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ApiLogsRuntimeCard } from './ApiLogsRuntimeCard';
import { ApiLogsRuntimeList } from './ApiLogsRuntimeList';

export function ApiLogsFrontendErrors() {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const query = useWebErrorsSummary();
  const state = useDataState(query);
  const { data, isLoading } = query;
  const rows = [...(data?.top ?? [])].sort((a, b) => b.count - a.count);
  const title = t('apiLogs.runtime.frontendTitle', 'Frontend error reports');
  const scope = data?.window_seconds != null
    ? data.window_seconds === 3600
      ? t('apiLogs.runtime.lastHour', 'Last hour; independent of API call filters.')
      : t('apiLogs.runtime.browserWindow', 'Last {{seconds}} seconds; independent of API call filters.', { seconds: fmtInt(data.window_seconds) })
    : t('apiLogs.runtime.browserWindowUnknown', 'Reporting window unavailable; independent of API call filters.');

  return (
    <ApiLogsRuntimeCard
      title={title}
      scope={scope}
      icon={Bug}
      count={data?.total != null ? fmtInt(data.total) : '—'}
      countLabel={t('apiLogs.frontendErrors.reportedBy', 'reported by browser sessions')}
      loading={isLoading && !data}
      context={
        <>
          <Caption className="block">{t('apiLogs.runtime.asOf', 'Summary as of')}</Caption>
          <Text as="p" variant="bodySm" className="mt-1">
            {data?.as_of ? <DateTime value={data.as_of} in="utc" /> : '—'}
          </Text>
        </>
      }
    >
      <StaleRefreshWarning state={state} label={title} />
      {isLoading && !data ? (
        <div role="status" aria-label={t('apiLogs.frontendErrors.loading', 'Loading frontend error summary')}>
          <Skeleton className="h-16" />
        </div>
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => query.refetch()} />
      ) : !data ? (
        <Text as="p" variant="bodySm">{t('apiLogs.frontendErrors.loadError', 'Unable to load frontend error summary.')}</Text>
      ) : rows.length > 0 ? (
        <>
          <Caption className="mb-2 block">{t('apiLogs.runtime.browserSources', 'Reported sources · most frequent first')}</Caption>
          <ApiLogsRuntimeList label={t('apiLogs.runtime.browserCategories', 'Frontend error sources')}>
            {rows.map((entry, index) => (
              <li key={`${entry.name}|${entry.route}|${index}`} className="border-t border-[var(--glass-border)] pt-3 first:border-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <Text as="p" variant="bodySm" className="min-w-0 break-words">{entry.name || '—'}</Text>
                  <Badge variant="warning" size="sm" className="shrink-0">{entry.count != null ? fmtInt(entry.count) : '—'}</Badge>
                </div>
                <Text as="p" variant="bodySm" mono className="mt-1 break-all">{entry.route || '—'}</Text>
              </li>
            ))}
          </ApiLogsRuntimeList>
        </>
      ) : (
        <Text as="p" variant="bodySm">
          {data.total === 0
            ? t('apiLogs.runtime.noBrowserReports', 'No browser error reports received in this window.')
            : t('apiLogs.frontendErrors.noBreakdown', 'No per-source breakdown available for the reported errors.')}
        </Text>
      )}
      <Caption className="mt-3 block border-t border-[var(--glass-border)] pt-3">
        {t('apiLogs.runtime.browserCoverage', 'Only reports received from browser sessions are counted. Disabled or unavailable reporting can leave errors unobserved; zero reports does not prove there were no frontend errors.')}
      </Caption>
    </ApiLogsRuntimeCard>
  );
}
