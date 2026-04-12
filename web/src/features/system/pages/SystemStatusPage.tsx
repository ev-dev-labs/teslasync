import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { KVList } from '@/components/data-display/KVList';
import { useSystemHealth } from '@/api/hooks/useAdmin';

export default function SystemStatusPage() {
  const { t } = useTranslation();
  const { data: health, isLoading, error } = useSystemHealth();

  const components = health ? Object.entries(health.components) : [];
  const okCount = components.filter(([, c]) => c.status === 'ok').length;
  const degradedCount = components.filter(([, c]) => c.status === 'degraded').length;
  const unhealthyCount = components.filter(([, c]) => c.status === 'unhealthy').length;

  return (
    <PageContainer
      title={t('System Status')}
      subtitle={t('Health monitoring for all backend services')}
      loading={isLoading}
      error={error as Error | null}
      empty={!health}
      emptyMessage={t('Unable to load system status.')}
      actions={
        <Badge
          variant={health?.status === 'healthy' ? 'success' : health?.status === 'degraded' ? 'warning' : 'danger'}
          dot
        >
          {health?.status ?? 'unknown'}
        </Badge>
      }
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Overall')} value={health?.status ?? '--'} />
        <StatCard label={t('Healthy')} value={okCount} />
        <StatCard label={t('Degraded')} value={degradedCount} />
        <StatCard label={t('Unhealthy')} value={unhealthyCount} />
      </Grid>

      {components.map(([name, comp]) => (
        <Card key={name}>
          <CardHeader
            title={name.charAt(0).toUpperCase() + name.slice(1)}
            action={
              <Badge variant={comp.status === 'ok' ? 'success' : comp.status === 'degraded' ? 'warning' : 'danger'} size="sm">
                {comp.status}
              </Badge>
            }
          />
          <KVList
            columns={2}
            items={[
              { label: t('Consecutive Failures'), value: String(comp.consecutiveFailures) },
              { label: t('Last Error'), value: comp.lastError ?? t('None') },
            ]}
          />
        </Card>
      ))}
    </PageContainer>
  );
}
