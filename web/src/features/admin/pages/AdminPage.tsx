import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { useSystemHealth, useAuditLogs } from '@/api/hooks/useAdmin';

export default function AdminPage() {
  const { t } = useTranslation();
  const { data: health, isLoading, error } = useSystemHealth();
  const { data: logs } = useAuditLogs();

  const healthVariant = health?.status === 'healthy' ? 'success' : health?.status === 'degraded' ? 'warning' : 'danger';
  const componentList = health ? Object.entries(health.components) : [];

  return (
    <PageContainer
      title={t('Admin Dashboard')}
      subtitle={t('System health, API keys, and audit log')}
      loading={isLoading}
      error={error as Error | null}
      empty={!health}
      emptyMessage={t('Unable to load system health.')}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard
          label={t('System Status')}
          value={health?.status ?? '--'}
          icon={<Badge variant={healthVariant} dot>{health?.status}</Badge>}
        />
        <StatCard label={t('Components')} value={componentList.length} />
        <StatCard label={t('Database Size')} value={health?.databaseSize ?? '--'} />
        <StatCard label={t('Tables')} value={health?.tableCount ?? 0} />
      </Grid>

      <Card>
        <CardHeader title={t('System Components')} />
        <div className="divide-y divide-gray-800">
          {componentList.map(([name, comp]) => (
            <div key={name} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="w-32 font-medium capitalize">{name}</span>
              <Badge variant={comp.status === 'ok' ? 'success' : comp.status === 'degraded' ? 'warning' : 'danger'} size="sm">
                {comp.status}
              </Badge>
              <span className="w-16 text-right">{comp.consecutiveFailures}</span>
              <span className="text-gray-400 truncate max-w-[200px]">{comp.lastError ?? '--'}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={t('Recent Audit Log')} subtitle={`${logs?.length ?? 0} entries`} />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
          {logs?.map((log) => (
            <div key={log.id} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="w-40 text-gray-400 shrink-0">{new Date(log.createdAt).toLocaleString()}</span>
              <span className="w-28 shrink-0">{log.action}</span>
              <span className="w-28 shrink-0">{log.resource}</span>
              <span className="text-gray-400 truncate max-w-[200px]">{log.details}</span>
            </div>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
