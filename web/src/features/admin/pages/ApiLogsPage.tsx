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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Time')}</th>
                <th className="py-2 px-3 text-left">{t('Method')}</th>
                <th className="py-2 px-3 text-left">{t('Endpoint')}</th>
                <th className="py-2 px-3 text-left">{t('Status')}</th>
                <th className="py-2 px-3 text-right">{t('Duration')}</th>
                <th className="py-2 px-3 text-left">{t('Error')}</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((log) => (
                <tr key={log.id} className="border-b border-gray-800">
                  <td className="py-2 px-3 text-gray-400 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="py-2 px-3">
                    <Badge variant={methodVariant[log.method] ?? 'neutral'} size="sm">{log.method}</Badge>
                  </td>
                  <td className="py-2 px-3 font-mono text-xs truncate max-w-[250px]">{log.url}</td>
                  <td className="py-2 px-3">
                    <Badge variant={statusVariant(log.statusCode)} size="sm">{log.statusCode}</Badge>
                  </td>
                  <td className="py-2 px-3 text-right">{log.durationMs}ms</td>
                  <td className="py-2 px-3 text-red-400 text-xs truncate max-w-[150px]">{log.error ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
