import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useNotificationReport } from '@/api/hooks/useNotifications';
import type { NotificationReport } from '@/api/types';
import { fmtInt } from '@/lib/numberFormat';

type Breakdown = NotificationReport['by_source'];

export function NotificationReportPanel({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  const query = useNotificationReport(from, to);
  const report = query.data;
  const breakdowns: { key: string; title: string; rows: Breakdown }[] = [
    { key: 'source', title: t('notifications.report.sources', 'Trigger sources'), rows: report?.by_source ?? [] },
    { key: 'type', title: t('notifications.report.types', 'Event types'), rows: report?.by_type ?? [] },
    { key: 'severity', title: t('notifications.report.severities', 'Severities'), rows: report?.by_severity ?? [] },
    { key: 'channel', title: t('notifications.report.channels', 'Delivery channels'), rows: report?.by_channel ?? [] },
    { key: 'status', title: t('notifications.report.statuses', 'Delivery outcomes'), rows: report?.by_status ?? [] },
  ];

  return (
    <section aria-label={t('notifications.report.title', 'Notification activity')} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PanelTitle>{t('notifications.report.title', 'Notification activity')}</PanelTitle>
          <Text variant="caption">{t('notifications.report.description', 'Explore triggers and delivery outcomes across every notification source. Historical periods remain available.')}</Text>
        </div>
      </div>

      {query.isLoading && <div className="grid gap-3 sm:grid-cols-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>}
      {query.isError && <GlassPanel className="p-5"><QueryError error={query.error} onRetry={() => { void query.refetch(); }} /></GlassPanel>}
      {report && !query.isError && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={t('notifications.report.triggered', 'Triggers recorded')} value={fmtInt(report.triggered)} />
            <MetricCard label={t('notifications.report.deliveries', 'Channel deliveries')} value={fmtInt(report.deliveries)} />
            <MetricCard label={t('notifications.report.fanout', 'Attributed deliveries per trigger')} value={report.triggered > 0 ? ((report.deliveries - report.uncorrelated_deliveries) / report.triggered).toFixed(1) : '—'} />
            <MetricCard label={t('notifications.report.uncorrelated', 'Unattributed deliveries')} value={fmtInt(report.uncorrelated_deliveries)} />
          </div>
          <Text variant="caption">{t('notifications.report.countNote', 'Trigger totals do not estimate missing identifiers. Older deliveries without an event identifier appear only in delivery counts.')}</Text>
          <ChartContainer
            title={t('notifications.report.timeline', 'Daily activity')}
            ariaLabel={t('notifications.report.timelineAria', 'Daily notification triggers and channel deliveries')}
            chartKey="notification-activity"
            height={280}
            empty={(report.daily ?? []).length === 0}
            data={report.daily ?? []}
            dataColumns={[
              { key: 'day', label: t('notifications.report.day', 'Day') },
              { key: 'triggered', label: t('notifications.report.triggered', 'Triggers recorded') },
              { key: 'deliveries', label: t('notifications.report.deliveries', 'Channel deliveries') },
            ]}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.daily ?? []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Bar dataKey="triggered" name={t('notifications.report.triggered', 'Triggers recorded')} fill="#22d3ee" hide={hiddenSeries?.isHidden('triggered') ?? false} />
                  <Bar dataKey="deliveries" name={t('notifications.report.deliveries', 'Channel deliveries')} fill="#a78bfa" hide={hiddenSeries?.isHidden('deliveries') ?? false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {breakdowns.map(group => (
              <GlassPanel key={group.key} className="p-4 sm:p-5">
                <PanelTitle>{group.title}</PanelTitle>
                {group.rows.length === 0 ? (
                  <EmptyState message={t('notifications.report.noActivity', 'No activity in this period')} actionTo={{ label: t('notifications.report.inbox', 'Open inbox'), to: '/notifications/inbox' }} />
                ) : (
                  <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {group.rows.map(row => (
                      <li key={row.key} className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-1 text-sm">
                        <span className="min-w-0 break-all text-[var(--text-secondary)]">
                          {t(`notifications.report.values.${row.key}`, row.key.replace(/_/g, ' '))}
                        </span>
                        <span className="shrink-0 font-medium text-[var(--text-primary)]">{fmtInt(row.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassPanel>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
