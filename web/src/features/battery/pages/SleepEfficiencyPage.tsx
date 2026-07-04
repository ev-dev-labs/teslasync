import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Eye, Clock, Zap, DollarSign, Thermometer, Gauge, AlertCircle } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, DataTable, Badge, PanelTitle, Text, Caption, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, AlertBanner, Skeleton, TableSkeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
  ChartContainer, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { CHART_COLORS } from '@/lib/colors';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { formatDateShort, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { SleepDrainEvent, SleepEfficiencyData } from '@/types/energy';
import { convertTempFromSI } from '@/lib/unitConversion';

/* ── Constants ── */

/** Per-state donut colours. Neon-on-surface hex is a chart affordance, not body text. */
const STATE_COLORS: Record<string, string> = {
  asleep: '#a855f7',
  online: '#00f0ff',
  driving: '#10b981',
  charging: '#f59e0b',
  updating: '#ec4899',
  suspended: '#6366f1',
};

const SENTRY_ON_COLOR = '#f59e0b';
const SENTRY_OFF_COLOR = '#a855f7';

/** Default rolling window (days) when no explicit range is available. */
const DEFAULT_RANGE_DAYS = 30;

/* ── Pure derivations (exported for unit testing) ── */

/**
 * Inclusive day-count for a `[start, end]` calendar window (YYYY-MM-DD).
 * Falls back to {@link DEFAULT_RANGE_DAYS} when either bound is missing or
 * unparseable — the raw subtraction previously yielded `NaN`, which then
 * leaked into the `?days=` query string.
 */
export function computeRangeDays(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  if (!start || !end) return DEFAULT_RANGE_DAYS;
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return DEFAULT_RANGE_DAYS;
  const diff = Math.round((endMs - startMs) / 86_400_000) + 1;
  return Math.max(1, diff);
}

/** One donut slice: display name, whole-minute value, colour, and hours label. */
export interface StatePieDatum {
  name: string;
  value: number;
  color: string;
  hours: string;
}

/**
 * Shape the raw per-state minute totals into donut-ready slices. Unknown
 * states fall back to their raw key + the first chart colour, and a missing
 * `total_minutes` is treated as 0 (never `NaN`).
 */
export function buildStatePieData(
  distribution: SleepEfficiencyData['state_distribution'] | undefined,
  stateLabels: Record<string, string>,
): StatePieDatum[] {
  return (distribution ?? []).map((s) => ({
    name: stateLabels[s.state] ?? s.state,
    value: Math.round(s.total_minutes ?? 0),
    color: STATE_COLORS[s.state] ?? CHART_COLORS[0],
    hours: fmtNumber((s.total_minutes ?? 0) / 60),
  }));
}

/** One grouped bar: metric name plus the sentry-on / sentry-off values. */
export interface SentryComparisonRow {
  name: string;
  sentry_on: number;
  sentry_off: number;
}

/** Localised axis labels for {@link buildSentryComparison}. */
export interface SentryComparisonLabels {
  drainRate: string;
  batteryLost: string;
}

/**
 * Pivot the sentry-on / sentry-off drain samples into the two grouped-bar
 * rows the comparison chart consumes. Absent samples null-safe to 0.
 */
export function buildSentryComparison(
  comparison: SleepEfficiencyData['sentry_comparison'] | undefined,
  labels: SentryComparisonLabels,
): SentryComparisonRow[] {
  const rows = comparison ?? [];
  const sentryOn = rows.find((s) => s.sentry_mode);
  const sentryOff = rows.find((s) => !s.sentry_mode);
  return [
    {
      name: labels.drainRate,
      sentry_on: sentryOn?.avg_drain_rate ?? 0,
      sentry_off: sentryOff?.avg_drain_rate ?? 0,
    },
    {
      name: labels.batteryLost,
      sentry_on: sentryOn?.avg_battery_lost ?? 0,
      sentry_off: sentryOff?.avg_battery_lost ?? 0,
    },
  ];
}

/** True when the comparison carries at least one non-zero value to plot. */
export function hasSentryData(rows: readonly SentryComparisonRow[]): boolean {
  return rows.some((d) => d.sentry_on > 0 || d.sentry_off > 0);
}

/* ── Component ── */

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('sleep.title', 'Sleep Efficiency'));
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const tempUnit = unitPrefs.temperature;

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  // Date range — canonical RangePicker. The backend handler accepts explicit
  // start/end (YYYY-MM-DD) so historical presets and custom calendar picks
  // return the actual chosen window; the derived `days` count is still passed
  // for backward-compat with older API builds.
  const { start, end, setRange } = useRangeState({
    persistKey: 'sleep-efficiency.range',
    defaultPresetId: '30d',
  });
  const days = useMemo(() => computeRangeDays(start, end), [start, end]);

  const sleepQuery = useSleepEfficiency(vehicleIdStr, days, start, end);
  const { data: sleep, isLoading, isError, error, refetch } = sleepQuery;

  /* ── i18n state labels (chart series) ── */

  const stateLabels = useMemo<Record<string, string>>(() => ({
    asleep: t('sleep.state.asleep', 'Sleeping'),
    online: t('sleep.state.online', 'Online/Idle'),
    driving: t('sleep.state.driving', 'Driving'),
    charging: t('sleep.state.charging', 'Charging'),
    updating: t('sleep.state.updating', 'Updating'),
    suspended: t('sleep.state.suspended', 'Suspended'),
  }), [t]);

  /* ── Derived data ── */

  const pieData = useMemo(
    () => buildStatePieData(sleep?.state_distribution, stateLabels),
    [sleep?.state_distribution, stateLabels],
  );

  const comparisonData = useMemo(
    () => buildSentryComparison(sleep?.sentry_comparison, {
      drainRate: t('sleep.drainRate', 'Drain Rate (%/hr)'),
      batteryLost: t('sleep.avgBatteryLost', 'Avg Battery Lost (%)'),
    }),
    [sleep?.sentry_comparison, t],
  );

  const hasComparison = hasSentryData(comparisonData);
  const recentEvents = sleep?.recent_events ?? [];

  /* ── Drain events table columns ── */

  const drainColumns = useMemo<Column<SleepDrainEvent>[]>(() => [
    {
      key: 'date',
      header: t('sleep.date', 'Date'),
      render: (event) => (
        <Text variant="bodySm">
          {formatDateShort(event.start_date)}
          <Caption className="ml-1">{formatTime(event.start_date)}</Caption>
        </Text>
      ),
    },
    {
      key: 'duration',
      header: t('sleep.duration', 'Duration'),
      render: (event) => (
        <Text variant="body" className="tabular-nums">{fmtNumber(event.duration_hours ?? 0)}h</Text>
      ),
    },
    {
      key: 'batteryLost',
      header: t('sleep.batteryLost', 'Battery Lost'),
      render: (event) => (
        <Text size="sm" className="tabular-nums text-rose-300">{fmtNumber(event.battery_lost ?? 0)}%</Text>
      ),
    },
    {
      key: 'drainRate',
      header: t('sleep.drainRateCol', 'Drain Rate'),
      render: (event) => (
        <Text size="sm" className={`tabular-nums ${(event.drain_rate ?? 0) > 1.5 ? 'text-rose-300' : 'text-emerald-300'}`}>
          {fmtNumber(event.drain_rate ?? 0)}%/hr
        </Text>
      ),
    },
    {
      key: 'sentry',
      header: t('sleep.sentry', 'Sentry'),
      render: (event) => event.sentry_mode ? (
        <Badge variant="warning" size="sm"><Eye className="mr-1 h-3 w-3" aria-hidden="true" />{t('common.on', 'On')}</Badge>
      ) : (
        <Badge variant="info" size="sm"><Moon className="mr-1 h-3 w-3" aria-hidden="true" />{t('common.off', 'Off')}</Badge>
      ),
    },
    {
      key: 'temp',
      header: t('sleep.temp', 'Temp'),
      render: (event) => event.outside_temp != null ? (
        <Text size="sm" color="secondary" className="flex items-center gap-1">
          <Thermometer className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
          {fmtNumber(convertTempFromSI(event.outside_temp, tempUnit))}{tempUnit}
        </Text>
      ) : (
        <Text size="sm" color="muted">—</Text>
      ),
    },
  ], [t, tempUnit]);

  /* ── Header actions ── */

  const actions = (
    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
      <VehicleSelect ariaLabel={t('sleep.selectVehicle', 'Select vehicle')} />
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        align="end"
        triggerTestId="sleep-efficiency-range"
      />
    </div>
  );

  return (
    <PageContainer
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t('sleep.subtitle', 'Analyze vehicle sleep patterns, vampire drain, and sentry mode costs')}
      query={sleepQuery}
      actions={actions}
    >
      {isError && !sleep && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('sleep.loadError', 'Failed to load sleep efficiency data')}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width metric grid, reflows to 6 columns on wide screens */}
      <FadeIn>
        <section aria-label={t('sleep.kpis', 'Sleep efficiency metrics')}>
          {isLoading ? (
            <div
              className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
              role="status"
              aria-busy="true"
              aria-label={t('common.loading', 'Loading')}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={96} className="rounded-xl" />
              ))}
            </div>
          ) : (
            <StaggerContainer className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              <StaggerItem>
                <MetricCard
                  icon={<Moon className="h-4 w-4" />}
                  label={t('sleep.efficiency', 'Sleep Efficiency')}
                  value={sleep ? `${fmtNumber(sleep.sleep_efficiency_pct ?? 0)}%` : '—'}
                  color="purple"
                  help={{
                    i18nKey: 'help.sleepEfficiency.body',
                    defaultValue:
                      'Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is better — more sleep means less vampire drain and lower battery wear.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon={<Clock className="h-4 w-4" />}
                  label={t('sleep.avgTimeToSleep', 'Avg Time to Sleep')}
                  value={sleep ? `${fmtInt(sleep.time_to_sleep_avg_min ?? 0)} min` : '—'}
                  color="cyan"
                  help={{
                    i18nKey: 'help.sleepEfficiency.timeToSleep',
                    defaultValue: 'Average minutes from when the car parks to when it enters low-power sleep.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon={<Eye className="h-4 w-4" />}
                  label={t('sleep.sentryDrainRate', 'Sentry Drain Rate')}
                  value={sleep ? `${fmtNumber(sleep.sentry_on_drain_rate ?? 0)}%/hr` : '—'}
                  color="amber"
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryDrain',
                    defaultValue:
                      'Battery loss per hour while Sentry Mode is active. Sentry keeps cameras and computers on, which adds noticeable drain.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon={<Gauge className="h-4 w-4" />}
                  label={t('sleep.sentryOffDrainRate', 'Sentry-Off Drain Rate')}
                  value={sleep ? `${fmtNumber(sleep.sentry_off_drain_rate ?? 0)}%/hr` : '—'}
                  color="green"
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryOffDrain',
                    defaultValue:
                      'Baseline battery loss per hour while parked with Sentry Mode off — the unavoidable idle drain.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon={<Zap className="h-4 w-4" />}
                  label={t('sleep.sentryMonthlyKwh', 'Sentry Monthly kWh')}
                  value={sleep ? `${fmtNumber(sleep.sentry_monthly_kwh ?? 0)} kWh` : '—'}
                  color="blue"
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryKwh',
                    defaultValue: 'Estimated energy consumed each month by Sentry-related drain.',
                  }}
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  icon={<DollarSign className="h-4 w-4" />}
                  label={t('sleep.sentryMonthlyCost', 'Sentry Monthly Cost')}
                  value={sleep ? formatCurrency(sleep.sentry_monthly_cost ?? 0) : '—'}
                  color="red"
                  help={{
                    i18nKey: 'help.sleepEfficiency.sentryCost',
                    defaultValue:
                      'Estimated monthly electricity cost of Sentry-related drain, using your configured per-kWh rate.',
                  }}
                />
              </StaggerItem>
            </StaggerContainer>
          )}
        </section>
      </FadeIn>

      {/* 2 — Charts bento: donut + sentry comparison + impact callout reflow across width */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('sleep.analysis', 'Sleep and sentry analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2 3xl:grid-cols-3"
        >
          {/* State Distribution donut */}
          {/* chart-a11y:no-table state-share donut; per-state hours announced via the legend below the chart */}
          <ChartContainer
            title={t('sleep.stateDistribution', 'State Distribution')}
            ariaLabel={t('sleep.stateDistribution.aria', 'State distribution donut chart with per-state hours in the legend')}
            height={300}
          >
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      animationDuration={800}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={`cell-${i}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 flex flex-wrap justify-center gap-3">
                  {pieData.map((entry) => (
                    <li key={entry.name} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                      <Text variant="bodySm">{entry.name}</Text>
                      <Caption>{entry.hours}h</Caption>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState /* no-action: transient — no state distribution data in the selected window */
                message={t('sleep.noStateData', 'No state distribution data available')}
              />
            )}
          </ChartContainer>

          {/* Sentry vs No-Sentry comparison */}
          {/* chart-a11y:no-table small comparison bar chart; numbers visible in the sentry impact panel */}
          <ChartContainer
            title={t('sleep.sentryComparison', 'Sentry vs No-Sentry')}
            ariaLabel={t('sleep.sentryComparison.aria', 'Sentry on versus sentry off drain comparison bar chart')}
            height={300}
          >
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : hasComparison ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={comparisonData}>
                  {chartGrid}
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sentry_on" name={t('sleep.sentryOn', 'Sentry On')} fill={SENTRY_ON_COLOR} radius={[4, 4, 0, 0]} animationDuration={800} />
                  <Bar dataKey="sentry_off" name={t('sleep.sentryOff', 'Sentry Off')} fill={SENTRY_OFF_COLOR} radius={[4, 4, 0, 0]} animationDuration={800} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient — no sentry comparison data in the selected window */
                message={t('sleep.noSentryData', 'No sentry comparison data available')}
              />
            )}
          </ChartContainer>

          {/* Sentry Monthly Impact — spans the row on md/xl, sits beside the charts on 3xl */}
          <GlassPanel className="border-amber-500/20 bg-amber-500/[0.06] p-4 sm:p-5 xl:col-span-2 3xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('sleep.monthlySentryImpact', 'Monthly Sentry Mode Impact')}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={72} />
            ) : (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <Text as="p" size="lg" weight="bold" className="tabular-nums text-amber-300">
                    {sleep ? `${fmtNumber(sleep.sentry_extra_drain_rate ?? 0)}%` : '—'}
                  </Text>
                  <Caption>{t('sleep.extraDrainHr', 'Extra drain/hr')}</Caption>
                </div>
                <div>
                  <Text as="p" size="lg" weight="bold" className="tabular-nums text-amber-300">
                    {sleep ? `${fmtNumber(sleep.sentry_extra_monthly_kwh ?? 0)} kWh` : '—'}
                  </Text>
                  <Caption>{t('sleep.extraMonthly', 'Extra monthly')}</Caption>
                </div>
                <div>
                  <Text as="p" size="lg" weight="bold" className="tabular-nums text-rose-300">
                    {sleep ? formatCurrency(sleep.sentry_extra_monthly_cost ?? 0) : '—'}
                  </Text>
                  <Caption>{t('sleep.extraCostMo', 'Extra cost/mo')}</Caption>
                </div>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Recent drain events: full-width detail band */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('sleep.recentDrainEvents', 'Recent Drain Events')}
          </PanelTitle>
          {isLoading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : recentEvents.length > 0 ? (
            <DataTable<SleepDrainEvent>
              tableId="battery:sleep-drain-events"
              columns={drainColumns}
              data={recentEvents}
              keyExtractor={(event) => event.id}
              emptyMessage={t('sleep.noDrainEvents', 'No drain events recorded yet')}
              compact
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient — no sleep/drain events recorded for this vehicle yet */
              icon={<Moon className="h-10 w-10 text-[var(--text-muted)]" aria-hidden="true" />}
              message={t('sleep.noDrainEvents', 'No drain events recorded yet')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
