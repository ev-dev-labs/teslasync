import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useNotificationChannels, useNotificationLogs, useNotificationStats } from '@/api/hooks/useNotifications';

const channelTypeVariant: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  discord: 'info', slack: 'success', telegram: 'info', email: 'warning', webhook: 'neutral', ntfy: 'success', pushover: 'warning',
};

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { data: channels, isLoading, error } = useNotificationChannels();
  const { data: logs } = useNotificationLogs();
  const { data: stats } = useNotificationStats();

  return (
    <PageContainer
      title={t('Notifications')}
      subtitle={t('Configure notification channels and view delivery history')}
      loading={isLoading}
      error={error as Error | null}
      actions={<Button variant="primary" size="sm">{t('Add Channel')}</Button>}
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Total Sent')} value={stats?.sent ?? 0} />
        <StatCard label={t('Failed')} value={stats?.failed ?? 0} />
        <StatCard label={t('Pending')} value={stats?.pending ?? 0} />
        <StatCard label={t('Active Channels')} value={`${stats?.enabledChannels ?? 0}/${stats?.totalChannels ?? 0}`} />
      </Grid>

      <Card>
        <CardHeader title={t('Notification Channels')} />
        {channels?.length ? (
          <div className="divide-y divide-gray-800">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={channelTypeVariant[ch.type] ?? 'neutral'} size="sm">{ch.type}</Badge>
                    <span className="font-semibold">{ch.name}</span>
                  </div>
                  <Badge variant={ch.enabled ? 'success' : 'neutral'} size="sm" className="mt-1">
                    {ch.enabled ? t('Active') : t('Disabled')}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">{t('Test')}</Button>
                  <Button size="sm" variant="outline">{t('Edit')}</Button>
                  <Button size="sm" variant="danger">{t('Delete')}</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message={t('No notification channels configured.')} />
        )}
      </Card>

      <Card>
        <CardHeader title={t('Delivery History')} subtitle={`${logs?.length ?? 0} entries`} />
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400">
                <th className="py-2 px-3 text-left">{t('Time')}</th>
                <th className="py-2 px-3 text-left">{t('Title')}</th>
                <th className="py-2 px-3 text-left">{t('Channel')}</th>
                <th className="py-2 px-3 text-left">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((log) => (
                <tr key={log.id} className="border-b border-gray-800">
                  <td className="py-2 px-3 text-gray-400 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="py-2 px-3">{log.title}</td>
                  <td className="py-2 px-3">{log.channelId}</td>
                  <td className="py-2 px-3">
                    <Badge variant={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'} size="sm">
                      {log.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageContainer>
  );
}
