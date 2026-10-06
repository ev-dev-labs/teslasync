import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BatteryWarning, Clock, Zap, Activity, ShieldAlert,
  Gauge, RefreshCw, TrendingDown,
} from 'lucide-react';

import { PageLayout, Section, CardGrid, LayoutCard } from '@/components/layout';
import { Badge, Button, DataTable, Caption, Text, type Column, useSortToggle } from '@/components/ui';
import { StatGroup, type StatMetric } from '@/components/data-display';
import { BatteryEvidenceBrief } from '../components/operationalbrief-all/BatteryEvidenceBrief';
import { useMetricPreferences } from '@/components/data-display/stat-reference';
import { formatMetric, type StatPeriod } from '@/lib/metric-reference';
import { AIVampireDrainExplanation } from '@/components/ai';
import {
  LinearGauge, ChartLegend, ChartTooltip, EmbeddedChart, AREA_DEFAULTS,
  chartMargin, axisTick, CHART_COLORS,
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { VampireSplitPanel, VampireCulpritPanel, SourceRecovery, sessionPresentation } from '../components/vampire-drain-modernization';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDate, formatDateTime, formatDayKey } from '@/lib/dateFormat';
import { localDayKey } from '@/lib/drivesAggregation';
import { useTimezone } from '@/lib/timezone';

import { request } from '@/api/client';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

/* ── Types (match internal/api/vampiredrain/handler.go — SI canonical) ── */

/** One parked window derived live from fsm_transitions (mig 000187). */
interface VampireDrainEvent {
  started_at: string;
  ended_at: string;
  duration_hours: number;
  start_battery_pct: number;
  end_battery_pct: number;
  drain_pct: number;
  drain_pct_per_day: number;
  /** SI °C — formatted at the display boundary via useUnits(). Nullable. */
  ambient_temp_c_avg: number | null;
}

interface VampireDrainEventsResponse {
  vehicle_id: number;
  events: VampireDrainEvent[];
}

interface VampireDrainStats {
  vehicle_id: number;
  event_count: number;
  total_observed_hours: number;
  avg_drain_pct_per_day: number | null;
  median_drain_pct_per_day: number | null;
  p95_drain_pct_per_day: number | null;
  sample_window_days: number;
}

export interface DailyDrainBucket {
  date: string;
  drain_pct: number;
  hours: number;
  [key: string]: string | number | null | undefined;
}

/**
 * Group drain events into calendar-day buckets in the given IANA timezone,
 * summing battery loss + parked hours per day, oldest first. Events with an
 * unparseable start are skipped. Bucketing must use the *vehicle's* day —
 * UTC slicing misattributed near-midnight sessions for non-UTC users.
 */
export function buildDailyDrainRollup(
  events: VampireDrainEvent[],
  timeZone?: string,
): DailyDrainBucket[] {
  const buckets = new Map<string, DailyDrainBucket>();
  for (const e of events) {
    const day = localDayKey(e.started_at, timeZone);
    if (!day) continue;
    const bucket = buckets.get(day) ?? { date: day, drain_pct: 0, hours: 0 };
    bucket.drain_pct += e.drain_pct ?? 0;
    bucket.hours += e.duration_hours ?? 0;
    buckets.set(day, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Visual reference for the drain-rate gauge: ≈5 %/day is a high phantom rate. */
const GAUGE_MAX = 5;

/* ── Component ── */

export default function VampireDrainPage() {
  const { fmtNumber, precision: displayPrecision } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('vampireDrain.title', 'Vampire drain'));

  const { formatTemperature } = useUnits();
  const { vehicleId } = useSelectedVehicle();
  const timeZone = useTimezone('vehicle');
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const enabled = activeId !== '';

  const statsQuery = useQuery<VampireDrainStats>({
    queryKey: ['vampire-drain-stats', activeId],
    queryFn: ({ signal }) => request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${activeId}`, { signal }),
    enabled,
  });
  const eventsQuery = useQuery<VampireDrainEventsResponse>({
    queryKey: ['vampire-drain-events', activeId],
    queryFn: ({ signal }) => request<VampireDrainEventsResponse>(`/vampire-drain?vehicle_id=${activeId}&limit=200`, { signal }),
    enabled,
  });

  const stats = statsQuery.data ?? null;
  const statsState = useDataState(statsQuery, { provenance: 'historical' });
  const eventsState = useDataState(eventsQuery, { provenance: 'historical' });
  const metricPreferences = useMetricPreferences();
  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);
  const dataSources = useMemo(
    () => [
      {
        id: 'drain-statistics',
        label: t('dataSources.labels.vampireDrainStats', 'Vampire-drain statistics'),
        query: statsQuery,
        enabled,
      },
      {
        id: 'parked-drain-events',
        label: t('dataSources.labels.vampireDrainEvents', 'Parked-drain events'),
        query: eventsQuery,
        enabled,
      },
    ],
    [enabled, eventsQuery, statsQuery, t],
  );

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('started_at');

  const sortedEvents = useMemo(
    () => sortFn(events, (row, key) => {
      const val = row[key as keyof VampireDrainEvent];
      return typeof val === 'number' ? val : String(val ?? '');
    }),
    [events, sortFn],
  );

  /** Drain-rate trend — one point per parked window, oldest first. */
  const trend = useMemo(
    () => [...events]
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .map((e) => ({ date: e.started_at, rate: e.drain_pct_per_day ?? null })),
    [events],
  );

  /** Daily rollup — sum battery loss and parked hours per vehicle-calendar day. */
  const daily = useMemo(
    () => buildDailyDrainRollup(events, timeZone),
    [events, timeZone],
  );

  const period: StatPeriod = {
    kind: 'unknown',
    label: stats?.sample_window_days != null
      ? t('vampireDrain.modernization.sampleWindow', '{{count}}-day sample window', { count: stats.sample_window_days })
      : t('vampireDrain.modernization.sampleUnknown', 'Sample window unavailable'),
    reason: t('vampireDrain.modernization.sampleScope', 'Statistics use the server sample window. Charts and sessions use up to 200 loaded parked windows; exact interval bounds are not supplied.'),
  };
  const metrics: StatMetric[] = [
    {
      metricId: 'percent', occurrenceId: 'vampire-average', rawValue: stats?.avg_drain_pct_per_day,
      label: t('vampireDrain.kpi.avg', 'Avg drain / day'),
      description: t('vampireDrain.help.avg', 'Mean battery loss per day while parked and not charging across the sample window.'),
    },
    {
      metricId: 'percent', occurrenceId: 'vampire-median', rawValue: stats?.median_drain_pct_per_day,
      label: t('vampireDrain.kpi.median', 'Median drain / day'),
      description: t('vampireDrain.help.median', 'Typical (50th percentile) daily battery loss — robust to one-off outliers.'),
    },
    {
      metricId: 'percent', occurrenceId: 'vampire-p95', rawValue: stats?.p95_drain_pct_per_day,
      label: t('vampireDrain.kpi.p95', 'P95 drain / day'),
      description: t('vampireDrain.help.p95', 'Worst-case (95th percentile) daily battery loss observed in the window.'),
    },
    {
      metricId: 'duration', occurrenceId: 'vampire-observed',
      rawValue: stats?.total_observed_hours != null ? stats.total_observed_hours * 3600 : null,
      display: { units: { duration: 'h' } },
      label: t('vampireDrain.kpi.observed', 'Observed hours'),
      description: t('vampireDrain.help.observed', 'Total parked, non-charging hours sampled for the drain statistics.'),
      context: stats?.event_count != null
        ? t('vampireDrain.kpi.sessions', '{{count}} sessions', { count: stats.event_count })
        : t('vampireDrain.modernization.sessionsUnknown', 'Session count unavailable'),
    },
  ];
  const avg = stats?.avg_drain_pct_per_day ?? null;
  const gaugeColor = avg == null
    ? CHART_COLORS[0]
    : avg <= 1.5 ? CHART_COLORS[2] : avg <= 3 ? CHART_COLORS[3] : CHART_COLORS[5];

  const columns: Column<VampireDrainEvent>[] = useMemo(() => [
    { key: 'started_at', header: t('vampireDrain.columns.started', 'Started'), sortable: true, render: (r) => formatDateTime(r.started_at) },
    { key: 'duration_hours', align: 'right', header: t('vampireDrain.columns.duration', 'Duration'), sortable: true, render: (r) => r.duration_hours != null ? `${fmtNumber(r.duration_hours)}h` : '—' },
    { key: 'start_battery_pct', align: 'right', header: t('vampireDrain.columns.startPct', 'Start %'), sortable: true, render: (r) => formatMetric('percent', r.start_battery_pct, metricPreferences).text },
    { key: 'end_battery_pct', align: 'right', header: t('vampireDrain.columns.endPct', 'End %'), sortable: true, render: (r) => formatMetric('percent', r.end_battery_pct, metricPreferences).text },
    {
      key: 'drain_pct', header: t('vampireDrain.columns.loss', 'Loss %'), sortable: true, render: (r) => (
        <Badge variant={r.drain_pct == null ? 'neutral' : r.drain_pct > 5 ? 'danger' : r.drain_pct > 2 ? 'warning' : 'success'}>
          {r.drain_pct != null ? `${fmtNumber(r.drain_pct)}%` : '—'}
        </Badge>
      ), align: 'right',
    },
    { key: 'drain_pct_per_day', align: 'right', header: t('vampireDrain.columns.rate', 'Rate %/day'), sortable: true, render: (r) => fmtNumber(r.drain_pct_per_day) },
    { key: 'ambient_temp_c_avg', align: 'right', header: t('vampireDrain.columns.temp', 'Ambient'), sortable: true, render: (r) => formatTemperature(r.ambient_temp_c_avg) },
  ], [t, formatTemperature, fmtNumber, metricPreferences]);

  const tips = useMemo(() => [
    { icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" />, text: t('vampireDrain.tips.sentry', 'Disable Sentry Mode when parked at home to save 1–2 % per day.') },
    { icon: <Clock className="h-4 w-4" aria-hidden="true" />, text: t('vampireDrain.tips.polling', 'Reduce third-party app polling intervals to let the car sleep faster.') },
    { icon: <BatteryWarning className="h-4 w-4" aria-hidden="true" />, text: t('vampireDrain.tips.wake', 'Avoid opening the app frequently — each wake cycle costs battery.') },
    { icon: <Activity className="h-4 w-4" aria-hidden="true" />, text: t('vampireDrain.tips.energySaver', 'Enable energy-saving mode in vehicle settings for better standby.') },
  ], [t]);

  const noVehicleMsg = t('vampireDrain.selectVehicle', 'Select a vehicle to view its vampire drain.');
  const noEventsMsg = t('vampireDrain.noEvents', 'No parked-drain sessions recorded in this window yet.');

  const actions = (
    <>
      <Button
        variant="ghost"
        className="min-h-11 min-w-11"
        onClick={() => { void statsQuery.refetch(); void eventsQuery.refetch(); }}
        aria-label={t('vampireDrain.refresh', 'Refresh vampire drain')}
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      />
    </>
  );

  return (
    <PageLayout
      title={t('vampireDrain.title', 'Vampire drain')}
      subtitle={t('vampireDrain.subtitle', 'Analyze phantom energy loss while your vehicle is parked')}
      secondaryActions={actions}
      query={[statsQuery, eventsQuery]}
      dataSources={dataSources}
    >
      {/* AI narrator — opt-in, never replaces the deterministic stats below (ADR-015 §I3/§I5). */}
      <FadeIn>
        <AIVampireDrainExplanation
          vehicleId={vehicleId ?? undefined}
          lookbackDays={stats?.sample_window_days}
        />
      </FadeIn>

      {/* 1 — KPI band */}
      <FadeIn>
        <Section id="vampire-summary" title={t('vampireDrain.kpis', 'Drain summary')}>
          <SourceRecovery state={statsState} label={t('dataSources.labels.vampireDrainStats', 'Vampire-drain statistics')} />
          {!enabled ? (
            <LayoutCard title={t('vampireDrain.kpis', 'Drain summary')}>
              <EmptyState
                icon={<Zap className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            </LayoutCard>
          ) : (
            <BatteryEvidenceBrief id="vampire-drain-summary" title={t('vampireDrain.brief.title', 'Observed parked-drain statistics')} metrics={metrics} period={period}
              loading={statsState.status === 'initial'} retained={statsState.hasData && statsState.status !== 'ok'} />
          )}
        </Section>
      </FadeIn>

      <FadeIn delay={0.04}>
        <VampireCulpritPanel vehicleId={activeId || undefined} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <VampireSplitPanel vehicleId={activeId || undefined} />
      </FadeIn>

      {/* 2 — Primary bento: trend (hero) + rate gauge */}
      <FadeIn delay={0.1}>
        <Section id="vampire-trend" title={t('vampireDrain.sections.trend', 'Drain rate trend and gauge')}>
          <SourceRecovery state={eventsState} label={t('dataSources.labels.vampireDrainEvents', 'Parked-drain events')} />
          <CardGrid label={t('vampireDrain.sections.trend', 'Drain rate trend and gauge')} items={[
            { id: 'drain-trend', size: 'half', content: (
          <LayoutCard title={t('vampireDrain.trend.title', 'Drain rate trend')}>
            {!enabled ? (
              <EmptyState
                icon={<TrendingDown className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : eventsState.status === 'initial' ? (
              <Skeleton height={240} />
            ) : eventsState.fatalError ? (
              <EmptyState message={t('vampireDrain.modernization.eventsUnavailable', 'Parked-drain events are unavailable. Retry the source above.')} />
            ) : trend.length === 0 ? (
              <EmptyState
                /* no-action: transient — the trend needs more parked-drain sessions to plot;
                   the header Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<TrendingDown className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <EmbeddedChart toolbar exportable size="standard"
                title={t('vampireDrain.trend.title', 'Drain rate trend')}
                ariaLabel={t('vampireDrain.trend.aria', 'Daily vampire drain rate over parked sessions')}
                data={trend}
                exportData={trend}
                fullscreen
                dataColumns={[
                  { key: 'date', label: t('vampireDrain.date', 'Date'), format: (value) => formatDate(String(value ?? '')) },
                  {
                    key: 'rate',
                    label: t('vampireDrain.trend.series', 'Drain rate (%/day)'),
                    format: (value) => value != null ? fmtNumber(Number(value)) : '—',
                  },
                ]}
                height={288}
                mobileHeight={224}
                chartKey="vampire-drain-rate-trend"
              >
                {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                    <YAxis tick={axisTick} unit="%" width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Line {...AREA_DEFAULTS} dataKey="rate" name={t('vampireDrain.trend.series', 'Drain rate (%/day)')} stroke={CHART_COLORS[0]} hide={hiddenSeries?.isHidden('rate')} />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </EmbeddedChart>
            )}
          </LayoutCard>
            ) },
            { id: 'drain-gauge', size: 'quarter', content: (
          <LayoutCard title={t('vampireDrain.gauge.title', 'Drain rate')}>
            {!enabled ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : statsState.status === 'initial' ? (
              <div className="flex justify-center py-4"><Skeleton width="180px" height={180} rounded /></div>
            ) : statsState.fatalError ? (
              <EmptyState message={t('vampireDrain.modernization.statsUnavailable', 'Drain statistics are unavailable. Retry the source in Drain summary.')} />
            ) : avg == null ? (
              <EmptyState
                /* no-action: transient — no parked-drain stats yet to average; the header
                   Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<Gauge className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <LinearGauge
                  value={avg}
                  max={GAUGE_MAX}
                  label={t('vampireDrain.gauge.label', 'Avg %/day')}
                  unit="%"
                  color={gaugeColor}
                  size={168}
                  decimals={displayPrecision}
                />
                <StatGroup metrics={metrics.slice(1, 3)} period={period} className="w-full" />
                <Caption>{t('vampireDrain.gauge.caption', 'Reference: ~5 %/day is a high phantom-drain rate. Lower is better.')}</Caption>
              </div>
            )}
          </LayoutCard>
            ) },
          ]} />
        </Section>
      </FadeIn>

      {/* 3 — Secondary bento: daily drain + tips */}
      <FadeIn delay={0.2}>
        <Section id="vampire-daily" title={t('vampireDrain.sections.daily', 'Daily drain and reduction tips')}>
          <CardGrid label={t('vampireDrain.sections.daily', 'Daily drain and reduction tips')} items={[
            { id: 'daily-drain', size: 'half', content: (
          <LayoutCard title={t('vampireDrain.daily.title', 'Daily drain while parked')}>
            {!enabled ? (
              <EmptyState
                icon={<BatteryWarning className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : eventsState.status === 'initial' ? (
              <Skeleton height={260} />
            ) : eventsState.fatalError ? (
              <EmptyState message={t('vampireDrain.modernization.eventsUnavailable', 'Parked-drain events are unavailable. Retry the source above.')} />
            ) : daily.length === 0 ? (
              <EmptyState
                /* no-action: transient — daily aggregates build up as parked-drain sessions are
                   recorded; the header Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<BatteryWarning className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <EmbeddedChart toolbar exportable size="standard"
                title={t('vampireDrain.daily.title', 'Daily drain while parked')}
                ariaLabel={t('vampireDrain.daily.aria', 'Daily battery loss and parked hours')}
                data={daily}
                exportData={daily}
                fullscreen
                dataColumns={[
                  { key: 'date', label: t('vampireDrain.date', 'Date'), format: (value) => formatDayKey(String(value ?? '')) },
                  {
                    key: 'drain_pct',
                    label: t('vampireDrain.daily.loss', 'Battery loss %'),
                    format: (value) => value != null ? fmtNumber(Number(value)) : '—',
                  },
                  {
                    key: 'hours',
                    label: t('vampireDrain.daily.parked', 'Parked hours'),
                    format: (value) => value != null ? fmtNumber(Number(value)) : '—',
                  },
                ]}
                height={288}
                mobileHeight={224}
                chartKey="vampire-drain-daily"
              >
                {({ hiddenSeries }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={daily} margin={chartMargin}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDayKey(v)} />
                      <YAxis yAxisId="left" tick={axisTick} unit="%" width={44} />
                      <YAxis yAxisId="right" orientation="right" tick={axisTick} unit="h" width={44} />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend />
                      <Bar yAxisId="left" dataKey="drain_pct" name={t('vampireDrain.daily.loss', 'Battery loss %')} fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('drain_pct')} />
                      <Bar yAxisId="right" dataKey="hours" name={t('vampireDrain.daily.parked', 'Parked hours')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('hours')} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </EmbeddedChart>
            )}
          </LayoutCard>
            ) },
            { id: 'drain-tips', size: 'quarter', content: (
          <LayoutCard title={t('vampireDrain.tips.title', 'Tips to reduce vampire drain')}>
            <ul className="space-y-3">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-[var(--text-secondary)]">{tip.icon}</span>
                  <Text variant="body">{tip.text}</Text>
                </li>
              ))}
            </ul>
          </LayoutCard>
            ) },
          ]} />
        </Section>
      </FadeIn>

      {/* 4 — Detail band: drain sessions */}
      <FadeIn delay={0.3}>
        <LayoutCard title={t('vampireDrain.sessions.title', 'Drain sessions')} actions={
            <Badge variant="neutral">
              {eventsState.hasData
                ? t('vampireDrain.sessions.count', '{{count}} sessions', { count: events.length })
                : t('vampireDrain.modernization.sessionsUnknown', 'Session count unavailable')}
            </Badge>
        }>
          {!enabled ? (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              message={noVehicleMsg}
              actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
            />
          ) : eventsState.status === 'initial' ? (
            <Skeleton height={220} />
          ) : eventsState.fatalError ? (
            <EmptyState
              message={t('vampireDrain.modernization.eventsUnavailable', 'Parked-drain events are unavailable. Retry the source above.')}
              action={{
                label: t('vampireDrain.modernization.retrySource', 'Retry {{source}}', {
                  source: t('dataSources.labels.vampireDrainEvents', 'Parked-drain events'),
                }),
                onClick: () => { void eventsQuery.refetch(); },
              }}
            />
          ) : (
            <DataTable<VampireDrainEvent>
              tableId="battery:vampire-drain-sessions"
              caption={t('vampireDrain.sessions.title', 'Drain sessions')}
              columns={columns}
              mobilePresentation={sessionPresentation(fmtNumber, formatTemperature, t)}
              data={sortedEvents}
              keyExtractor={(r) => r.started_at}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyMessage={noEventsMsg}
              compact
              pagination
            />
          )}
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
