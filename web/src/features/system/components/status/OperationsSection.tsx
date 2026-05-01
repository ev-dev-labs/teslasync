import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Bell, Send, CheckCircle, XCircle, Activity } from 'lucide-react';
import { Grid } from '@/components/layout';
import { Badge, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { RadialGauge } from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { getAuditLogs as getDevtoolsAuditLogs } from '@/api/devtools';
import { getNotificationStats, getNotificationLogs } from '@/api/settings';
import type { NotificationLog, AuditLog } from '@/api/types';
import { AccordionSection } from './AccordionSection';
import { getStatusIcon, statusTextClass } from './helpers';

export function OperationsSection() {
  const { t } = useTranslation();

  const { data: notifStats, isLoading: statsLoading } = useQuery({
    queryKey: ['system-status', 'notification-stats'],
    queryFn: getNotificationStats,
    refetchInterval: 15_000,
  });

  const { data: notifLogs, isLoading: logsLoading } = useQuery({
    queryKey: ['system-status', 'notification-logs'],
    queryFn: () => getNotificationLogs(10, 0),
    refetchInterval: 15_000,
  });

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['system-status', 'audit-logs'],
    queryFn: () => getDevtoolsAuditLogs(20),
    refetchInterval: 30_000,
  });

  const isLoading = statsLoading || logsLoading || auditLoading;

  const successRate =
    notifStats && notifStats.total_sent > 0
      ? (notifStats.sent / notifStats.total_sent) * 100
      : 100;

  const notifLogColumns: Column<NotificationLog>[] = [
    {
      key: 'status', header: t('Status'),
      render: (row) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(row.status)}
          <span className={statusTextClass(row.status)}>{row.status}</span>
        </div>
      ),
    },
    {
      key: 'title', header: t('Title'),
      render: (row) => <span className="text-white/90 truncate max-w-[200px] block">{row.title}</span>,
    },
    {
      key: 'message', header: t('Message'),
      render: (row) => <span className="text-xs text-white/40 truncate max-w-[250px] block">{row.message}</span>,
    },
    { key: 'created_at', header: t('Time'), render: (row) => formatDateTime(row.created_at) },
  ];

  const auditColumns: Column<AuditLog>[] = [
    { key: 'created_at', header: t('Time'), render: (row) => formatDateTime(row.created_at) },
    { key: 'action', header: t('Action'), render: (row) => <Badge variant="info" size="sm">{row.action}</Badge> },
    { key: 'resource', header: t('Resource'), render: (row) => <span className="font-mono text-xs">{row.resource}</span> },
    {
      key: 'details', header: t('Details'),
      render: (row) => <span className="text-xs text-white/40 truncate max-w-[250px] block">{row.details}</span>,
    },
  ];

  return (
    <AccordionSection
      icon={<Bell className="h-5 w-5" />}
      title={t('Operations')}
      description={t('Notification delivery and audit trail')}
      badges={
        notifStats ? (
          <Badge
            variant={successRate >= 95 ? 'success' : successRate >= 80 ? 'warning' : 'danger'}
            size="sm"
          >
            {fmtPercent(successRate, 1)} {t('success rate')}
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {notifStats && (
            <div>
              <h4 className="text-sm font-semibold text-white/90 mb-3">{t('Notification Delivery')}</h4>
              <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                <MetricCard label={t('Total Sent')} value={fmtInt(notifStats.total_sent)} icon={<Send className="h-4 w-4" />} color="cyan" />
                <MetricCard label={t('Failed')} value={fmtInt(notifStats.failed)} icon={<XCircle className="h-4 w-4" />} color="red" />
                <MetricCard label={t('Success Rate')} value={fmtPercent(successRate, 1)} icon={<CheckCircle className="h-4 w-4" />} color="green" />
                <MetricCard label={t('Channels')} value={`${notifStats.enabled_channels}/${notifStats.total_channels}`} icon={<Bell className="h-4 w-4" />} color="purple" />
              </Grid>

              <div className="flex justify-center mb-4">
                <RadialGauge
                  value={successRate}
                  max={100}
                  label={t('Success')}
                  unit="%"
                  color={successRate >= 95 ? '#22c55e' : successRate >= 80 ? '#f59e0b' : '#ef4444'}
                  size={120}
                />
              </div>

              {notifLogs ? (
                <DataTable
                  columns={notifLogColumns}
                  data={notifLogs}
                  keyExtractor={(l) => l.id}
                  compact
                  pagination={{ defaultPageSize: 50 }}
                  emptyMessage={t('No recent notifications')}
                />
              ) : (
                <EmptyState
                  icon={<Activity className="h-8 w-8 opacity-20" />}
                  message={t('common.noData', 'No data available')}
                  className="py-8"
                />
              )}
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-white/90 mb-3">{t('Audit Log')}</h4>
            {auditLogs && auditLogs.length > 0 ? (
              <DataTable
                columns={auditColumns}
                data={auditLogs}
                keyExtractor={(l) => l.id}
                compact
                pagination={{ defaultPageSize: 50 }}
                emptyMessage={t('No audit entries')}
              />
            ) : (
              <EmptyState message={t('No audit log entries')} />
            )}
          </div>
        </div>
      )}
    </AccordionSection>
  );
}
