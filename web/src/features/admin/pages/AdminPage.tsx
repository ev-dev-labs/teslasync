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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Component')}</th>
                <th className="py-2 px-3 text-left">{t('Status')}</th>
                <th className="py-2 px-3 text-right">{t('Failures')}</th>
                <th className="py-2 px-3 text-left">{t('Last Error')}</th>
              </tr>
            </thead>
            <tbody>
              {componentList.map(([name, comp]) => (
                <tr key={name} className="border-b border-gray-800">
                  <td className="py-2 px-3 font-medium capitalize">{name}</td>
                  <td className="py-2 px-3">
                    <Badge variant={comp.status === 'ok' ? 'success' : comp.status === 'degraded' ? 'warning' : 'danger'} size="sm">
                      {comp.status}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-right">{comp.consecutiveFailures}</td>
                  <td className="py-2 px-3 text-gray-400 truncate max-w-[200px]">{comp.lastError ?? '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('Recent Audit Log')} subtitle={`${logs?.length ?? 0} entries`} />
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Time')}</th>
                <th className="py-2 px-3 text-left">{t('Action')}</th>
                <th className="py-2 px-3 text-left">{t('Resource')}</th>
                <th className="py-2 px-3 text-left">{t('Details')}</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((log) => (
                <tr key={log.id} className="border-b border-gray-800">
                  <td className="py-2 px-3 text-gray-400">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="py-2 px-3">{log.action}</td>
                  <td className="py-2 px-3">{log.resource}</td>
                  <td className="py-2 px-3 text-gray-400 truncate max-w-[200px]">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
