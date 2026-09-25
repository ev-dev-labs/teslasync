import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, CheckCircle, AlertTriangle, Clock, AlertCircle } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { GlassPanel } from '@/components/ui';
import { QueryError, StatGridSkeleton } from '@/components/feedback';
import type { AutomationHistoryListResponse } from '@/api/types';
import { formatDurationMs } from '@/lib/dateFormat';

export function AutomationHistorySummary({ query }: { query: UseQueryResult<AutomationHistoryListResponse> }) {
  const { t } = useTranslation();
  const summary = query.data?.summary;
  return (
    <section aria-label={t('automations.historyPage.summary', 'Execution summary')}>
      {query.isLoading && !summary ? <StatGridSkeleton cards={6} /> : !summary ? (
        <GlassPanel className="p-5">
          <QueryError error={query.error} onRetry={() => { void query.refetch(); }} />
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <MetricCard label={t('automations.historyPage.total', 'Completed runs')} value={summary.total_executions} icon={<Activity className="h-5 w-5" />} />
          <MetricCard label={t('automations.historyPage.success', 'Succeeded')} value={summary.succeeded} color="green" icon={<CheckCircle className="h-5 w-5" />} />
          <MetricCard label={t('automations.historyPage.failed', 'Failed')} value={summary.failed} color="red" icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label={t('automations.historyPage.partial', 'Partial')} value={summary.partial} color="amber" icon={<AlertCircle className="h-5 w-5" />} />
          <MetricCard label={t('automations.historyPage.rate', 'Success rate')} value={summary.total_executions > 0 ? `${summary.success_rate.toFixed(1)}%` : '—'} />
          <MetricCard label={t('automations.historyPage.duration', 'Average duration')} value={summary.total_executions > 0 ? formatDurationMs(summary.avg_duration_ms) : '—'} icon={<Clock className="h-5 w-5" />} />
        </div>
      )}
    </section>
  );
}
