import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ChartContainer, ChartLegend, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { OperationalBrief, DataProvenanceBadge, type StatMetric } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useNotificationReport } from '@/api/hooks/useNotifications';
import { useDataState } from '@/hooks/useDataState';
import type { NotificationReport } from '@/api/types';

import { notificationEventTypeFallback } from '@/lib/notificationEventType';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

type Breakdown = NotificationReport['by_source'];

export function NotificationReportPanel({ fromInstant, toExclusive, timezone }: { fromInstant: string; toExclusive: string; timezone: string }) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useNotificationReport(fromInstant, toExclusive, timezone);
  const state = useDataState(query, { provenance: 'historical' });
  const report = query.data;
  const daily = report?.daily;
  const resolution = (daily?.length ?? 0) > 3650 ? 4 : (daily?.length ?? 0) > 730 ? 7 : 10;
  const timeline = useMemo(() => {
    const buckets = new Map<string, { period: string; triggered: number; deliveries: number }>();
    for (const row of daily ?? []) {
      const period = row.day.slice(0, resolution);
      const bucket = buckets.get(period) ?? { period, triggered: 0, deliveries: 0 };
      bucket.triggered += row.triggered;
      bucket.deliveries += row.deliveries;
      buckets.set(period, bucket);
    }
    return Array.from(buckets.values());
  }, [daily, resolution]);
  const timelineTitle = resolution === 4
    ? t('notifications.report.timelineAnnual', 'Annual activity')
    : resolution === 7
      ? t('notifications.report.timelineMonthly', 'Monthly activity')
      : t('notifications.report.timeline', 'Daily activity');
  const timelineAria = resolution === 4
    ? t('notifications.report.timelineAriaAnnual', 'Annual notification triggers and channel deliveries')
    : resolution === 7
      ? t('notifications.report.timelineAriaMonthly', 'Monthly notification triggers and channel deliveries')
      : t('notifications.report.timelineAria', 'Daily notification triggers and channel deliveries');
  const breakdowns: { key: string; title: string; rows: Breakdown }[] = [
    { key: 'source', title: t('notifications.report.sources', 'Trigger sources'), rows: report?.by_source ?? [] },
    { key: 'type', title: t('notifications.report.types', 'Event types'), rows: report?.by_type ?? [] },
    { key: 'severity', title: t('notifications.report.severities', 'Severities'), rows: report?.by_severity ?? [] },
    { key: 'channel', title: t('notifications.report.channels', 'Delivery channels'), rows: report?.by_channel ?? [] },
    { key: 'status', title: t('notifications.report.statuses', 'Delivery outcomes'), rows: report?.by_status ?? [] },
  ];
  const reportColumns = useMemo<Column<Breakdown[number]>[]>(() => [
    {
      key: 'label', header: t('notifications.report.category', 'Category'),
      defaultWidth: 200, minWidth: 100,
      render: (row) => <span title={row.key} className="min-w-0 break-all text-[var(--text-secondary)]">{t(`notifications.report.values.${row.key}`, notificationEventTypeFallback(row.key))}</span>,
    },
    {
      key: 'count', header: t('notifications.report.count', 'Count'),
      defaultWidth: 85, minWidth: 65, align: 'right',
      render: (row) => fmtInt(row.count),
    },
  ], [t, fmtInt]);
  const countNote = t('notifications.report.countNote', 'Trigger totals do not estimate missing identifiers. Older deliveries without an event identifier appear only in delivery counts.');
  const httpScope = t('notifications.report.httpScope', 'Counts use the View settings window. Outbound HTTP calls include retries and failures; they are not channel deliveries. Compare with Notifications under API Logs’ By Service for the same window.');
  const scope = t('notifications.report.brief.scope', '{{from}} to {{to}} (exclusive) · {{timezone}}', {
    from: fromInstant, to: toExclusive, timezone,
  });
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'report-triggered', rawValue: report?.triggered,
      label: t('notifications.report.triggered', 'Triggers recorded'), context: countNote },
    { metricId: 'count', occurrenceId: 'report-deliveries', rawValue: report?.deliveries,
      label: t('notifications.report.deliveries', 'Channel deliveries') },
    { metricId: 'number', occurrenceId: 'report-fanout',
      rawValue: report && report.triggered > 0 ? (report.deliveries - report.uncorrelated_deliveries) / report.triggered : null,
      label: t('notifications.report.fanout', 'Linked deliveries per trigger'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'report-uncorrelated', rawValue: report?.uncorrelated_deliveries,
      label: t('notifications.report.uncorrelated', 'Deliveries without a linked trigger') },
    { metricId: 'count', occurrenceId: 'report-http', rawValue: report?.outbound_http_calls,
      label: t('notifications.report.outboundCalls', 'Outbound HTTP calls'), context: httpScope },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const firstLoad = query.isLoading && !state.hasData;

  return (
    <section aria-label={t('notifications.report.title', 'Notification activity')} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PanelTitle>{t('notifications.report.title', 'Notification activity')}</PanelTitle>
          <Text variant="caption">{t('notifications.report.description', 'Explore triggers and delivery outcomes across every notification source. Historical periods remain available.')}</Text>
        </div>
      </div>

      {state.fatalError && <GlassPanel className="p-5"><QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} /></GlassPanel>}
      <StaleRefreshWarning state={state} label={t('notifications.report.title', 'Notification activity')} />
      <OperationalBrief compact loading={firstLoad} testId="notification-report-brief"
        eyebrow={t('notifications.report.title', 'Notification activity')}
        title={t('notifications.report.brief.title', 'Triggers, linked deliveries, and outbound calls')}
        description={t('notifications.report.description', 'Explore triggers and delivery outcomes across every notification source. Historical periods remain available.')}
        statusLabel={firstLoad ? t('common.loading', 'Loading…') : state.status === 'stale' ? t('dataState.stale.title', 'Data may be stale')
          : state.status === 'offline' ? t('dataState.offline.title', 'Offline')
            : report ? t('notifications.report.brief.available', 'Report loaded')
              : t('notifications.report.brief.unavailable', 'Report unavailable')}
        statusTone={state.fatalError || state.status === 'stale' || state.status === 'offline' ? 'warning' : 'neutral'}
        metrics={operationalMetrics}
        scope={scope}
        freshness={<DataProvenanceBadge provenance={state.provenance} status={state.status} updatedAt={state.updatedAt} />}
        provenance={`${scope}. ${httpScope}`} />
      <ChartContainer
        title={timelineTitle}
        ariaLabel={timelineAria}
        chartKey="notification-activity"
        height={280}
        loading={firstLoad}
        error={state.fatalError}
        onRetry={() => { void query.refetch(); }}
        empty={timeline.length === 0}
        data={timeline}
        dataColumns={[
          { key: 'period', label: t('notifications.report.period', 'Period') },
          { key: 'triggered', label: t('notifications.report.triggered', 'Triggers recorded') },
          { key: 'deliveries', label: t('notifications.report.deliveries', 'Channel deliveries') },
        ]}
      >
        {({ hiddenSeries }) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
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
            {firstLoad ? <Skeleton className="h-24" /> : !report ? (
              <Text variant="bodySm" color="muted">
                {t('notifications.report.brief.unavailable', 'Report unavailable')}
              </Text>
            ) : group.rows.length === 0 ? (
              <EmptyState message={t('notifications.report.noActivity', 'No activity in this period')} actionTo={{ label: t('notifications.report.inbox', 'Open inbox'), to: '/notifications/inbox' }} />
            ) : (
              <div className="mt-3 min-w-0">
                <DataTable
                  name={group.title}
                  tableId={`notifications:report:${group.key}`}
                  data={group.rows}
                  keyExtractor={(row) => row.key}
                  columns={reportColumns}
                  density="compact"
                  resizable
                  columnReorder
                  stickyHeader
                  maxHeight={256}
                />
              </div>
            )}
          </GlassPanel>
        ))}
      </div>
    </section>
  );
}
