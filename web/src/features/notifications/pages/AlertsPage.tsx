import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useAlerts, useMarkAlertRead } from '@/api/hooks/useNotifications';

const severityVariant: Record<string, 'info' | 'warning' | 'danger'> = {
  info: 'info', warning: 'warning', critical: 'danger',
};

function formatTimeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function AlertsPage() {
  const { t } = useTranslation();
  const { data: alerts, isLoading, error } = useAlerts();
  const markRead = useMarkAlertRead();

  const unread = useMemo(() => alerts?.filter((a) => !a.isRead).length ?? 0, [alerts]);

  return (
    <PageContainer
      title={t('Alerts')}
      subtitle={t('Alert history and management')}
      loading={isLoading}
      error={error as Error | null}
      actions={unread > 0 ? <Badge variant="danger">{unread} {t('unread')}</Badge> : undefined}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total')} value={alerts?.length ?? 0} />
        <StatCard label={t('Unread')} value={unread} />
        <StatCard label={t('Critical')} value={alerts?.filter((a) => a.severity === 'critical').length ?? 0} />
        <StatCard label={t('Warnings')} value={alerts?.filter((a) => a.severity === 'warning').length ?? 0} />
      </Grid>

      {alerts?.length ? (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card
              key={alert.id}
              className={alert.isRead ? 'opacity-60' : ''}
            >
              <div className="flex items-start justify-between px-4 py-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant[alert.severity] ?? 'info'} size="sm">{alert.severity}</Badge>
                    <span className="text-xs text-gray-400">{formatTimeAgo(alert.createdAt)}</span>
                  </div>
                  <p className={`font-semibold ${alert.isRead ? 'text-gray-400' : ''}`}>{alert.title}</p>
                  <p className="text-sm text-gray-400">{alert.message}</p>
                  <Badge variant="neutral" size="sm">{alert.type}</Badge>
                </div>
                {!alert.isRead && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={markRead.isPending}
                    onClick={() => markRead.mutate(alert.id)}
                  >
                    {t('Mark read')}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState message={t('No alerts yet.')} />
      )}
    </PageContainer>
  );
}
