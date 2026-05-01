import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Eye, Clock, Zap, DollarSign, Thermometer } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, Badge, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
  ChartContainer, ChartTooltip, chartGrid, axisTick,
} from '@/components/charts';
import { CHART_COLORS } from '@/lib/colors';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { formatDateShort, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { DAYS_OPTIONS } from '@/lib/constants';
import type { SleepDrainEvent } from '@/types/energy';

/* ── Constants ── */

const STATE_COLORS: Record<string, string> = {
  asleep: '#a855f7',
  online: '#00f0ff',
  driving: '#10b981',
  charging: '#f59e0b',
  updating: '#ec4899',
  suspended: '#6366f1',
};

/* ── Component ── */

export default function SleepEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('sleep.title', 'Sleep Efficiency'));
  const { convertTemp, tempUnit } = useSettings();

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [days, setDays] = useState(30);

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  const { data: sleep, isLoading, error } = useSleepEfficiency(vehicleIdStr, days);

  /* ── Derived data ── */

  const pieData = useMemo(() =>
    (sleep?.state_distribution ?? []).map((s) => ({
      name: STATE_LABELS[s.state] ?? s.state,
      value: Math.round(s.total_minutes),
      color: STATE_COLORS[s.state] ?? CHART_COLORS[0],
      hours: fmtNumber(s.total_minutes / 60),
    })),
    [sleep?.state_distribution],
  );

  const sentryOn = sleep?.sentry_comparison?.find((s) => s.sentry_mode);
  const sentryOff = sleep?.sentry_comparison?.find((s) => !s.sentry_mode);

  const comparisonData = useMemo(() => [
    {
      name: t('sleep.drainRate', 'Drain Rate (%/hr)'),
      sentry_on: sentryOn?.avg_drain_rate ?? 0,
      sentry_off: sentryOff?.avg_drain_rate ?? 0,
    },
    {
      name: t('sleep.avgBatteryLost', 'Avg Battery Lost (%)'),
      sentry_on: sentryOn?.avg_battery_lost ?? 0,
      sentry_off: sentryOff?.avg_battery_lost ?? 0,
    },
  ], [sentryOn, sentryOff, t]);

  const recentEvents = sleep?.recent_events ?? [];

  /* ── Drain events table columns ── */

  const drainColumns: Column<SleepDrainEvent>[] = useMemo(() => [
    {
      key: 'date',
      header: t('sleep.date', 'Date'),
      render: (event) => (
        <span className="text-xs">
          {formatDateShort(event.start_date)}
          <span className="text-[var(--text-muted)] ml-1">{formatTime(event.start_date)}</span>
        </span>
      ),
    },
    {
      key: 'duration',
      header: t('sleep.duration', 'Duration'),
      render: (event) => <>{fmtNumber(event.duration_hours)}h</>,
    },
    {
      key: 'batteryLost',
      header: t('sleep.batteryLost', 'Battery Lost'),
      render: (event) => <span className="text-rose-300">{fmtNumber(event.battery_lost)}%</span>,
    },
    {
      key: 'drainRate',
      header: t('sleep.drainRateCol', 'Drain Rate'),
      render: (event) => (
        <span className={event.drain_rate > 1.5 ? 'text-rose-300' : 'text-emerald-300'}>
          {fmtNumber(event.drain_rate)}%/hr
        </span>
      ),
    },
    {
      key: 'sentry',
      header: t('sleep.sentry', 'Sentry'),
      render: (event) => event.sentry_mode ? (
        <Badge variant="warning" size="sm"><Eye className="h-3 w-3 mr-1" />{t('common.on', 'On')}</Badge>
      ) : (
        <Badge variant="info" size="sm"><Moon className="h-3 w-3 mr-1" />{t('common.off', 'Off')}</Badge>
      ),
    },
    {
      key: 'temp',
      header: t('sleep.temp', 'Temp'),
      render: (event) => event.outside_temp != null ? (
        <span className="flex items-center gap-1">
          <Thermometer className="h-3 w-3 text-[var(--text-muted)]" />
          {fmtNumber(convertTemp(event.outside_temp))}{tempUnit}
        </span>
      ) : (
        <span className="text-[var(--text-muted)]">—</span>
      ),
    },
  ], [t]);

  return (
    <PageContainer
      title={t('sleep.title', 'Sleep Efficiency')}
      subtitle={t('sleep.subtitle', 'Analyze vehicle sleep patterns, vampire drain, and sentry mode costs')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      actions={
        <div className="flex items-center gap-3">
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            options={DAYS_OPTIONS}
          />
          {vehicles && vehicles.length > 1 && (
            <Select
              value={vehicleId != null ? String(vehicleId) : ''}
              onChange={(e) => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
        </div>
      }
    >
      {sleep ? (
        <>
          {/* Key metric cards */}
          <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StaggerItem>
              <MetricCard
                icon={<Moon className="h-4 w-4" />}
                label={t('sleep.efficiency', 'Sleep Efficiency')}
                value={`${fmtNumber(sleep.sleep_efficiency_pct)}%`}
                color="purple"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Clock className="h-4 w-4" />}
                label={t('sleep.avgTimeToSleep', 'Avg Time to Sleep')}
                value={`${fmtInt(sleep.time_to_sleep_avg_min)} min`}
                color="cyan"
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<Eye className="h-4 w-4" />}
                label={t('sleep.sentryDrainRate', 'Sentry Drain Rate')}
                value={`${fmtNumber(sleep.sentry_on_drain_rate)}%/hr`}
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                icon={<DollarSign className="h-4 w-4" />}
                label={t('sleep.sentryMonthlyCost', 'Sentry Monthly Cost')}
                value={`$${fmtNumber(sleep.sentry_monthly_cost)}`}
                color="red"
              />
            </StaggerItem>
          </StaggerContainer>

          {/* State Distribution Donut + Sentry Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn>
              <ChartContainer title={t('sleep.stateDistribution', 'State Distribution')} height={264}>
                {pieData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
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
                    <div className="flex flex-wrap justify-center gap-3 mt-2">
                      {pieData.map((entry) => (
                        <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span className="text-[var(--text-secondary)]">{entry.name}</span>
                          <span className="text-[var(--text-muted)]">{entry.hours}h</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState message={t('sleep.noStateData', 'No state distribution data available')} />
                )}
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="flex flex-col gap-4">
                <ChartContainer title={t('sleep.sentryComparison', 'Sentry vs No-Sentry')} height={224}>
                  {comparisonData.some((d) => d.sentry_on > 0 || d.sentry_off > 0) ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={comparisonData}>
                        {chartGrid}
                        <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="sentry_on" name={t('sleep.sentryOn', 'Sentry On')} fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={800} />
                        <Bar dataKey="sentry_off" name={t('sleep.sentryOff', 'Sentry Off')} fill="#a855f7" radius={[4, 4, 0, 0]} animationDuration={800} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState message={t('sleep.noSentryData', 'No sentry comparison data available')} />
                  )}
                </ChartContainer>

                {/* Sentry cost callout — outside ChartContainer to avoid overflow */}
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">
                      {t('sleep.monthlySentryImpact', 'Monthly Sentry Mode Impact')}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmtNumber(sleep.sentry_extra_drain_rate)}%</p>
                      <p className="text-xs text-[var(--text-muted)]">{t('sleep.extraDrainHr', 'Extra drain/hr')}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmtNumber(sleep.sentry_extra_monthly_kwh)} kWh</p>
                      <p className="text-xs text-[var(--text-muted)]">{t('sleep.extraMonthly', 'Extra monthly')}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-rose-300">${fmtNumber(sleep.sentry_extra_monthly_cost)}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t('sleep.extraCostMo', 'Extra cost/mo')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>

          {/* Recent drain events table */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-6">
              <h3 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <Zap className="h-4 w-4 text-neon-cyan" />
                {t('sleep.recentDrainEvents', 'Recent Drain Events')}
              </h3>
              {recentEvents.length > 0 ? (
                <DataTable<SleepDrainEvent>
                  columns={drainColumns}
                  data={recentEvents}
                  keyExtractor={(event) => event.id}
                  emptyMessage={t('sleep.noDrainEvents', 'No drain events recorded yet')}
                  compact
                  pagination
                />
              ) : (
                <EmptyState message={t('sleep.noDrainEvents', 'No drain events recorded yet')} />
              )}
            </GlassPanel>
          </FadeIn>
        </>
      ) : !isLoading ? (
        <GlassPanel className="p-8">
          <EmptyState
            icon={<Moon className="h-10 w-10 text-[var(--text-muted)]" />}
            message={t('sleep.noData', 'No sleep data available. Data will appear after your vehicle records sleep/wake events.')}
          />
        </GlassPanel>
      ) : null}
    </PageContainer>
  );
}

/* ── State labels ── */

const STATE_LABELS: Record<string, string> = {
  asleep: 'Sleeping',
  online: 'Online/Idle',
  driving: 'Driving',
  charging: 'Charging',
  updating: 'Updating',
  suspended: 'Suspended',
};
