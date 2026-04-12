import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { useApiLogs, useApiLogStats } from '@/api/hooks/useAdmin';

const methodVariant: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  GET: 'success', POST: 'info', PUT: 'warning', DELETE: 'danger', PATCH: 'warning',
};

function statusVariant(code: number): 'success' | 'info' | 'warning' | 'danger' {
  if (code < 300) return 'success';
  if (code < 400) return 'info';
  if (code < 500) return 'warning';
  return 'danger';
}

export default function ApiLogsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data: logs, isLoading, error } = useApiLogs(page);
  const { data: stats } = useApiLogStats();

  return (
    <PageContainer
      title={t('API Logs')}
      subtitle={t('Tesla API call history and performance')}
      loading={isLoading}
      error={error as Error | null}
      empty={!logs?.length}
      emptyMessage={t('No API logs recorded yet.')}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Calls')} value={stats?.totalCalls ?? 0} />
        <StatCard label={t('Error Rate')} value={`${stats?.errorRate?.toFixed(1) ?? '0'}%`} />
        <StatCard label={t('Avg Duration')} value={`${stats?.avgDurationMs?.toFixed(0) ?? '0'}`} unit="ms" />
        <StatCard label={t('Last 24h')} value={stats?.last24h ?? 0} />
      </Grid>

      <Card>
        <CardHeader title={t('API Call Log')} />
        <div className="divide-y divide-gray-800">
          {logs?.map((log) => (
            <div key={log.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-36 text-gray-400 text-xs shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
              <Badge variant={methodVariant[log.method] ?? 'neutral'} size="sm">{log.method}</Badge>
              <span className="font-mono text-xs truncate max-w-[250px] flex-1">{log.url}</span>
              <Badge variant={statusVariant(log.statusCode)} size="sm">{log.statusCode}</Badge>
              <span className="w-16 text-right shrink-0">{log.durationMs}ms</span>
              <span className="text-red-400 text-xs truncate max-w-[150px]">{log.error ?? '--'}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('Previous')}</Button>
        <span className="text-sm text-gray-400 self-center">{t('Page')} {page}</span>
        <Button size="sm" variant="outline" onClick={() => setPage(page + 1)}>{t('Next')}</Button>
      </div>
    </PageContainer>
  );
}
