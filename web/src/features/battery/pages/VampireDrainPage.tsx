import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BatteryWarning, Clock, Zap, Activity, Lightbulb, ShieldAlert,
  Gauge, RefreshCw, TrendingDown,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, DataTable, PanelTitle, Caption, Text, type Column, useSortToggle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { AIVampireDrainExplanation } from '@/components/ai/AIVampireDrainExplanation';
import {
  RadialGauge, ChartTooltip, AREA_DEFAULTS,
  chartMargin, axisTick, CHART_COLORS,
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { request } from '@/api/client';

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

/** Visual reference for the drain-rate gauge: ≈5 %/day is a high phantom rate. */
const GAUGE_MAX = 5;

/* ── Component ── */

export default function VampireDrainPage() {
  const { t } = useTranslation();
  usePageTitle(t('vampireDrain.title', 'Vampire Drain'));

  const { formatTemperature } = useUnits();
  const { vehicleId } = useSelectedVehicle();
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
  const events = useMemo(() => eventsQuery.data?.events ?? [], [eventsQuery.data]);

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
      .map((e) => ({ date: e.started_at, rate: e.drain_pct_per_day ?? 0 })),
    [events],
  );

  /** Daily rollup — sum battery loss and parked hours per calendar day. */
  const daily = useMemo(() => {
    const buckets = new Map<string, { date: string; drain_pct: number; hours: number }>();
    for (const e of events) {
      const d = new Date(e.started_at);
      if (Number.isNaN(d.getTime())) continue;
      const day = d.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? { date: day, drain_pct: 0, hours: 0 };
      bucket.drain_pct += e.drain_pct ?? 0;
      bucket.hours += e.duration_hours ?? 0;
      buckets.set(day, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  const pct = (v: number | null | undefined) => (v == null ? '—' : `${fmtNumber(v, 2)}%`);
  const avg = stats?.avg_drain_pct_per_day ?? null;
  const gaugeColor = avg == null
    ? CHART_COLORS[0]
    : avg <= 1.5 ? CHART_COLORS[2] : avg <= 3 ? CHART_COLORS[3] : CHART_COLORS[5];

  const columns: Column<VampireDrainEvent>[] = useMemo(() => [
    { key: 'started_at', header: t('vampireDrain.columns.started', 'Started'), sortable: true, render: (r) => formatDateTime(r.started_at) },
    { key: 'duration_hours', header: t('vampireDrain.columns.duration', 'Duration'), sortable: true, render: (r) => `${fmtNumber(r.duration_hours, 1)}h` },
    { key: 'start_battery_pct', header: t('vampireDrain.columns.startPct', 'Start %'), sortable: true, render: (r) => `${fmtNumber(r.start_battery_pct, 0)}%` },
    { key: 'end_battery_pct', header: t('vampireDrain.columns.endPct', 'End %'), sortable: true, render: (r) => `${fmtNumber(r.end_battery_pct, 0)}%` },
    {
      key: 'drain_pct', header: t('vampireDrain.columns.loss', 'Loss %'), sortable: true, render: (r) => (
        <Badge variant={r.drain_pct > 5 ? 'danger' : r.drain_pct > 2 ? 'warning' : 'success'}>
          {fmtNumber(r.drain_pct, 1)}%
        </Badge>
      ),
    },
    { key: 'drain_pct_per_day', header: t('vampireDrain.columns.rate', 'Rate %/day'), sortable: true, render: (r) => fmtNumber(r.drain_pct_per_day, 2) },
    { key: 'ambient_temp_c_avg', header: t('vampireDrain.columns.temp', 'Ambient'), sortable: true, render: (r) => formatTemperature(r.ambient_temp_c_avg) },
  ], [t, formatTemperature]);

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
      <VehicleSelect />
      <Button
        variant="ghost"
        onClick={() => { void statsQuery.refetch(); void eventsQuery.refetch(); }}
        aria-label={t('vampireDrain.refresh', 'Refresh vampire drain')}
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      />
    </>
  );

  return (
    <PageContainer
      title={t('vampireDrain.title', 'Vampire Drain')}
      subtitle={t('vampireDrain.subtitle', 'Analyze phantom energy loss while your vehicle is parked')}
      actions={actions}
      query={[statsQuery, eventsQuery]}
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
        <section
          aria-label={t('vampireDrain.kpis', 'Drain summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {!enabled ? (
            <GlassPanel className="col-span-2 p-4 sm:p-5 lg:col-span-4">
              <EmptyState
                icon={<Zap className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            </GlassPanel>
          ) : statsQuery.isLoading ? (
            <>
              <Skeleton height={92} rounded />
              <Skeleton height={92} rounded />
              <Skeleton height={92} rounded />
              <Skeleton height={92} rounded />
            </>
          ) : statsQuery.isError ? (
            <GlassPanel className="col-span-2 p-4 sm:p-5 lg:col-span-4">
              <QueryError error={statsQuery.error} onRetry={() => { void statsQuery.refetch(); }} />
            </GlassPanel>
          ) : (
            <>
              <MetricCard
                label={t('vampireDrain.kpi.avg', 'Avg Drain / day')}
                value={pct(stats?.avg_drain_pct_per_day)}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                color="purple"
                help={{ i18nKey: 'vampireDrain.help.avg', defaultValue: 'Mean battery loss per day while parked and not charging across the sample window.' }}
              />
              <MetricCard
                label={t('vampireDrain.kpi.median', 'Median Drain / day')}
                value={pct(stats?.median_drain_pct_per_day)}
                icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
                help={{ i18nKey: 'vampireDrain.help.median', defaultValue: 'Typical (50th percentile) daily battery loss — robust to one-off outliers.' }}
              />
              <MetricCard
                label={t('vampireDrain.kpi.p95', 'P95 Drain / day')}
                value={pct(stats?.p95_drain_pct_per_day)}
                icon={<TrendingDown className="h-4 w-4" aria-hidden="true" />}
                color="red"
                help={{ i18nKey: 'vampireDrain.help.p95', defaultValue: 'Worst-case (95th percentile) daily battery loss observed in the window.' }}
              />
              <MetricCard
                label={t('vampireDrain.kpi.observed', 'Observed Hours')}
                value={fmtNumber(stats?.total_observed_hours, 1)}
                subtitle={t('vampireDrain.kpi.sessions', '{{count}} sessions', { count: stats?.event_count ?? 0 })}
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                color="amber"
                help={{ i18nKey: 'vampireDrain.help.observed', defaultValue: 'Total parked, non-charging hours sampled for the drain statistics.' }}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Primary bento: trend (hero) + rate gauge */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('vampireDrain.sections.trend', 'Drain rate trend and gauge')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('vampireDrain.trend.title', 'Drain Rate Trend')}
            </PanelTitle>
            {!enabled ? (
              <EmptyState
                icon={<TrendingDown className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : eventsQuery.isLoading ? (
              <Skeleton height={240} />
            ) : eventsQuery.isError ? (
              <QueryError error={eventsQuery.error} onRetry={() => { void eventsQuery.refetch(); }} />
            ) : trend.length === 0 ? (
              <EmptyState
                /* no-action: transient — the trend needs more parked-drain sessions to plot;
                   the header Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<TrendingDown className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                    <YAxis tick={axisTick} unit="%" width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line {...AREA_DEFAULTS} dataKey="rate" name={t('vampireDrain.trend.series', 'Drain Rate (%/day)')} stroke={CHART_COLORS[0]} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('vampireDrain.gauge.title', 'Drain Rate')}
            </PanelTitle>
            {!enabled ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : statsQuery.isLoading ? (
              <div className="flex justify-center py-4"><Skeleton width="180px" height={180} rounded /></div>
            ) : statsQuery.isError ? (
              <QueryError error={statsQuery.error} onRetry={() => { void statsQuery.refetch(); }} />
            ) : avg == null ? (
              <EmptyState
                /* no-action: transient — no parked-drain stats yet to average; the header
                   Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<Gauge className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
                <RadialGauge
                  value={avg}
                  max={GAUGE_MAX}
                  label={t('vampireDrain.gauge.label', 'Avg %/day')}
                  unit="%"
                  color={gaugeColor}
                  size={168}
                  decimals={2}
                />
                <div className="w-full space-y-1">
                  <div className="flex items-center justify-between">
                    <Text variant="bodySm">{t('vampireDrain.kpi.median', 'Median Drain / day')}</Text>
                    <Text variant="bodySm" className="tabular-nums text-[var(--text-primary)]">{pct(stats?.median_drain_pct_per_day)}</Text>
                  </div>
                  <div className="flex items-center justify-between">
                    <Text variant="bodySm">{t('vampireDrain.kpi.p95', 'P95 Drain / day')}</Text>
                    <Text variant="bodySm" className="tabular-nums text-[var(--text-primary)]">{pct(stats?.p95_drain_pct_per_day)}</Text>
                  </div>
                </div>
                <Caption>{t('vampireDrain.gauge.caption', 'Reference: ~5 %/day is a high phantom-drain rate. Lower is better.')}</Caption>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Secondary bento: daily drain + tips */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('vampireDrain.sections.daily', 'Daily drain and reduction tips')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BatteryWarning className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('vampireDrain.daily.title', 'Daily Drain While Parked')}
            </PanelTitle>
            {!enabled ? (
              <EmptyState
                icon={<BatteryWarning className="h-8 w-8" />}
                message={noVehicleMsg}
                actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
              />
            ) : eventsQuery.isLoading ? (
              <Skeleton height={260} />
            ) : eventsQuery.isError ? (
              <QueryError error={eventsQuery.error} onRetry={() => { void eventsQuery.refetch(); }} />
            ) : daily.length === 0 ? (
              <EmptyState
                /* no-action: transient — daily aggregates build up as parked-drain sessions are
                   recorded; the header Refresh control (RefreshCw button) already covers manual re-checks. */
                icon={<BatteryWarning className="h-8 w-8" />}
                message={noEventsMsg}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDate(v)} />
                    <YAxis yAxisId="left" tick={axisTick} unit="%" width={44} />
                    <YAxis yAxisId="right" orientation="right" tick={axisTick} unit="h" width={44} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar yAxisId="left" dataKey="drain_pct" name={t('vampireDrain.daily.loss', 'Battery Loss %')} fill={CHART_COLORS[5]} radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="hours" name={t('vampireDrain.daily.parked', 'Parked Hours')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel glow="green" className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('vampireDrain.tips.title', 'Tips to Reduce Vampire Drain')}
            </PanelTitle>
            <ul className="space-y-3">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-emerald-300">{tip.icon}</span>
                  <Text variant="body">{tip.text}</Text>
                </li>
              ))}
            </ul>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Detail band: drain sessions */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <PanelTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('vampireDrain.sessions.title', 'Drain Sessions')}
            </PanelTitle>
            <Badge variant="neutral">
              {t('vampireDrain.sessions.count', '{{count}} sessions', { count: events.length })}
            </Badge>
          </div>
          {!enabled ? (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              message={noVehicleMsg}
              actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
            />
          ) : eventsQuery.isLoading ? (
            <Skeleton height={220} />
          ) : eventsQuery.isError ? (
            <QueryError error={eventsQuery.error} onRetry={() => { void eventsQuery.refetch(); }} />
          ) : (
            <DataTable<VampireDrainEvent>
              tableId="battery:vampire-drain-sessions"
              columns={columns}
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
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
