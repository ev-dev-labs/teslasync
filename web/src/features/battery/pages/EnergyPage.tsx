import { useState, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Zap, Leaf, Fuel, Sun, Moon, ArrowRight, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import {
  RadialGauge, ChartContainer, ChartLegend, ChartTooltip, ChartGradient,
  chartGrid, axisTickSm, renderAnnotationLines,
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, ReferenceLine,
  PieChart, Pie, Cell, Brush, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
  ChartTimeRangeProvider, useSyncedCursor, useSyncedReferenceLineX,
} from '@/components/charts';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, QueryError, EmptyState, ChartBlockSkeleton, StatGridSkeleton, PageHeaderSkeleton } from '@/components/feedback';
import { Currency, SavedViewMenu } from '@/components/data-display';
import { DateRangeFilter } from '@/components/forms';

import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useVehicles, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlString } from '@/hooks/useUrlState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtPercent } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { chartTokens } from '@/lib/tokens';
import type { ChargingSession } from '@/api/types';

/* ── Local: Cost Comparison Card ────────────────────────────────── */

function CostComparisonCard({
  label, evCost, gasCost, icon,
}: {
  label: string; evCost: number; gasCost: number; icon: React.ReactNode;
}) {
  const { t } = useTranslation();
  const savings = (gasCost ?? 0) - (evCost ?? 0);
  const savingsPct = gasCost > 0 ? (savings / gasCost) * 100 : 0;
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-green/10 text-neon-green">
          {icon}
        </div>
        <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {t('energy.cost.evCost', 'EV Cost')}
          </p>
          <p className="text-lg font-bold text-cyan-300"><Currency value={evCost ?? 0} /></p>
        </div>
        <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            {t('energy.cost.gasEquivalent', 'Gas Equivalent')}
          </p>
          <p className="text-lg font-bold text-[var(--text-secondary)]">
            <Currency value={gasCost ?? 0} />
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-emerald-300">
          {t('energy.cost.saving', 'Saving')} <Currency value={savings ?? 0} />
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green font-semibold">
          {fmtPercent(savingsPct ?? 0)} {t('energy.cost.less', 'less')}
        </span>
      </div>
    </GlassPanel>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

/**
 * Phase-40 / Prompt 62 — render-prop helper that subscribes the inner recharts
 * chart to the surrounding `<ChartTimeRangeProvider>`. The two daily-energy
 * panels share the same `daily_breakdown` dataset (matching `date` axis), so
 * they sync hover cursors and a persistent reference line through this helper.
 */
function EnergyChartSync({
  children,
}: {
  children: (state: {
    sync: ReturnType<typeof useSyncedCursor>;
    syncedX: ReturnType<typeof useSyncedReferenceLineX>;
  }) => ReactNode;
}) {
  const sync = useSyncedCursor();
  const syncedX = useSyncedReferenceLineX();
  return <>{children({ sync, syncedX })}</>;
}

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the EnergyPage layout while data loads:
 * page header → 4 hero radial gauges → 6-card metric strip →
 * lifetime metrics panel → 2 cost-comparison cards → 2 chart panels.
 * Phase-45 / Prompt 18.
 */
function EnergyPageSkeleton() {
  return (
    <div className="space-y-6" data-testid="energy-page-skeleton">
      <PageHeaderSkeleton />
      <Skeleton className="h-44 sm:h-56 rounded-xl" />
      <StatGridSkeleton cards={6} className="sm:grid-cols-4 lg:grid-cols-6" />
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartBlockSkeleton height={280} />
        <ChartBlockSkeleton height={280} />
      </div>
      <ChartBlockSkeleton height={320} />
    </div>
  );
}

export default function EnergyPage() {
  const { t } = useTranslation();
  usePageTitle(t('energy.title', 'Energy'));
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings();
  const savedView = useSavedViewUrl();

  /* ── Vehicle selector ─────────────────────────────────────────── */
  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;

  /* ── Date range ───────────────────────────────────────────────── */
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useUrlString('from', defaultStartDate);
  const [endDate, setEndDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  /* Phase-46 / Prompt 67 — URL-persisted hidden-series state for the
     two-series energy/efficiency composed chart. */
  const energyCostHidden = useHiddenSeries('energy-cost-daily');

  /* ── Data fetching ────────────────────────────────────────────── */
  const {
    data: stats, isLoading, error: statsError, refetch,
  } = useEnergyStats(vehicleId != null ? String(vehicleId) : null, 30);

  const { data: sessions } = useChargingSessionsPaginated(vehicleId, {
    limit: 100, start: startDate, end: endDate,
  });

  const { data: liveCharging } = useChargingTelemetryLatest(vehicleId ?? 0);

  /* ── Derived metrics ──────────────────────────────────────────── */
  const totalEnergy = sessions?.reduce((s, c) => s + c.energy_added_kwh, 0) ?? 0;
  const totalCost = sessions?.reduce((s, c) => s + (c.cost ?? 0), 0) ?? 0;
  const avgEfficiency = stats?.avg_efficiency_wh_per_mi ?? 0;
  const totalDistance = stats?.total_distance_mi ?? 0;
  const co2Saved = stats?.co2_saved_kg ?? totalEnergy * 0.42;

  const periodDays = Math.max(
    1,
    Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000),
  );
  const costPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;
  const costPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
  const gasEquivalent = totalDistance * 0.12;
  const monthlyProjectedCost = costPerKm > 0 ? costPerKm * (totalDistance / periodDays) * 30 : 0;
  const yearlyProjectedCost = monthlyProjectedCost * 12;

  const dailyEnergy = stats?.daily_breakdown ?? [];

  /* ── No-data banner gate ───────────────────────────────────────────
   * Replay vehicles + brand-new accounts have no charging sessions and
   * no computed energy stats. Showing 4 RadialGauges all at 0 looks
   * like a perfectly efficient car using zero energy. Render an
   * honest empty hero instead of misleading zeros.
   */
  const hasNoEnergyData = useMemo(() => {
    const noSessions = !sessions || sessions.length === 0;
    const noStats = !stats || (
      (stats.total_kwh ?? 0) === 0 &&
      (stats.total_energy_used_kwh ?? 0) === 0 &&
      (stats.total_distance_mi ?? 0) === 0
    );
    return noSessions && noStats;
  }, [sessions, stats]);

  /* ── Time-of-day analysis ─────────────────────────────────────── */
  const timeOfDayData = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const labels = [
      t('energy.timeOfDay.night', 'Night (0-6)'),
      t('energy.timeOfDay.morning', 'Morning (6-12)'),
      t('energy.timeOfDay.afternoon', 'Afternoon (12-18)'),
      t('energy.timeOfDay.evening', 'Evening (18-24)'),
    ];
    const buckets: Record<string, { count: number; energy: number }> = {};
    labels.forEach((l) => { buckets[l] = { count: 0, energy: 0 }; });
    sessions.forEach((s) => {
      const hour = new Date(s.start_ts).getHours();
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[labels[idx]].count++;
      buckets[labels[idx]].energy += s.energy_added_kwh;
    });
    return labels.map((name) => ({ name, ...buckets[name] }));
  }, [sessions, t]);

  /* ── Charger-type breakdown ───────────────────────────────────── */
  const chargerBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    const types: Record<string, { count: number; energy: number; cost: number }> = {};
    sessions.forEach((s) => {
      const label = s.charger_type?.toLowerCase().includes('tesla')
        ? 'Supercharger'
        : s.charger_type ? 'DC Fast' : 'Home/AC';
      if (!types[label]) types[label] = { count: 0, energy: 0, cost: 0 };
      types[label].count++;
      types[label].energy += s.energy_added_kwh;
      types[label].cost += s.cost ?? 0;
    });
    return Object.entries(types).map(([name, data]) => ({
      name,
      ...data,
      fill: CHARGER_COLORS[name] ?? '#00f0ff',
    }));
  }, [sessions]);

  /* ── Table columns ────────────────────────────────────────────── */
  const sessionColumns: Column<ChargingSession>[] = useMemo(() => [
    {
      key: 'date',
      header: t('energy.table.date', 'Date'),
      render: (s) => (
        <Link to={`/charging/${s.id}`} className="hover:text-cyan-300 transition-colors">
          {formatDateShort(s.start_ts)}
        </Link>
      ),
    },
    {
      key: 'energy',
      header: t('energy.table.energy', 'Energy'),
      render: (s) => (
        <span className="text-cyan-300 font-medium">
          {fmtNumber(s.energy_added_kwh ?? 0)} kWh
        </span>
      ),
    },
    {
      key: 'battery',
      header: t('energy.table.battery', 'Battery'),
      render: (s) => (
        <>
          <span className="text-[var(--text-muted)]">{s.start_battery_pct}%</span>
          <span className="text-gray-700 mx-1">→</span>
          <span className="text-emerald-300">{s.end_battery_pct ?? '—'}%</span>
        </>
      ),
    },
    {
      key: 'power',
      header: t('energy.table.power', 'Power'),
      render: (s) => <>{s.charger_power_kw_max != null ? `${fmtNumber(s.charger_power_kw_max)} kW` : '—'}</>,
    },
    {
      key: 'type',
      header: t('energy.table.type', 'Type'),
      render: (s) => {
        const isTesla = s.charger_type?.toLowerCase().includes('tesla');
        const isFast = !!s.charger_type;
        const cls = isTesla
          ? 'bg-neon-red/10 text-neon-red ring-neon-red/20'
          : isFast
            ? 'bg-neon-amber/10 text-neon-amber ring-neon-amber/20'
            : 'bg-neon-green/10 text-neon-green ring-neon-green/20';
        const label = isTesla ? 'Supercharger' : s.charger_type || 'AC';
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${cls}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'cost',
      header: t('energy.table.cost', 'Cost'),
      render: (s) => <>{typeof s.cost === 'number' ? `$${fmtNumber(s.cost)}` : '—'}</>,
    },
    {
      key: 'perKwh',
      header: t('energy.table.perKwh', '$/kWh'),
      render: (s) => (
        <span className="text-[var(--text-muted)]">
          {typeof s.cost === 'number' && s.energy_added_kwh > 0
            ? `$${fmtNumber(s.cost / s.energy_added_kwh)}`
            : '—'}
        </span>
      ),
    },
  ], [t]);

  /* ── Loading short-circuit (Phase-45 / Prompt 18) ─────────────── */
  if (isLoading) {
    return <EnergyPageSkeleton />;
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('energy.pageTitle', 'Energy Intelligence')}
      subtitle={t('energy.pageSubtitle', 'Deep cost analytics, efficiency trends, savings projections, and consumption patterns')}
      error={statsError as Error | null}
      actions={
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {vehicles && vehicles.length > 1 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={(e) => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
              className="text-sm"
            />
          )}
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onRangeChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
          />
          <SavedViewMenu
            route="/energy"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      {statsError && <QueryError error={statsError} onRetry={refetch} />}

      {/* ── Hero Gauges ─────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          {hasNoEnergyData ? (
            <EmptyState /* no-action: surfaces when no energy data exists yet — user must drive/charge to populate */
              icon={<Zap className="h-10 w-10" />}
              message={t('energy.empty.hero', 'No energy data yet — connect your vehicle and complete a drive or charging session to see efficiency, cost, and CO₂ savings.')}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 items-center">
              <RadialGauge
                value={totalEnergy}
                max={Math.max(totalEnergy * 1.3, 100)}
                label={t('energy.gauge.energyUsed', 'Energy Used')}
                unit="kWh"
                color="#00f0ff"
              />
              <RadialGauge
                value={convertEfficiency(avgEfficiency || (totalDistance > 0 ? (totalEnergy * 1000) / totalDistance : 0))}
                max={convertEfficiency(300)}
                label={t('energy.gauge.efficiency', 'Efficiency')}
                unit={efficiencyUnit}
                color="#10b981"
              />
              <RadialGauge
                value={co2Saved}
                max={Math.max(co2Saved * 1.5, 50)}
                label={t('energy.gauge.co2Saved', 'CO₂ Saved')}
                unit="kg"
                color="#a855f7"
              />
              <RadialGauge
                value={totalCost}
                max={Math.max(totalCost * 1.5, 50)}
                label={t('energy.gauge.totalCost', 'Total Cost')}
                unit="$"
                color="#f59e0b"
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Quick Metrics Strip ─────────────────────────────────── */}
      <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: t('energy.metric.costPerDist', { unit: distanceUnit, defaultValue: 'Cost per {{unit}}' }), value: `$${fmtNumber(totalDistance > 0 ? totalCost / convertDistance(totalDistance) : 0)}`, color: 'text-neon-cyan' },
          { label: t('energy.metric.costPerKwh', 'Cost per kWh'), value: `$${fmtNumber(costPerKwh ?? 0)}`, color: 'text-neon-green' },
          { label: t('energy.metric.totalDistance', 'Total Distance'), value: `${fmtInt(convertDistance(totalDistance ?? 0))} ${distanceUnit}`, color: 'text-[var(--text-primary)]' },
          { label: t('energy.metric.sessions', 'Sessions'), value: `${sessions?.length ?? 0}`, color: 'text-neon-purple' },
          { label: t('energy.metric.monthlyEst', 'Monthly Est.'), value: `$${fmtNumber(monthlyProjectedCost ?? 0)}`, color: 'text-neon-amber' },
          { label: t('energy.metric.yearlyEst', 'Yearly Est.'), value: `$${fmtNumber(yearlyProjectedCost ?? 0)}`, color: 'text-neon-red' },
        ].map((m) => (
          <StaggerItem key={m.label}>
            <GlassPanel className="p-3 text-center">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{m.label}</p>
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
            </GlassPanel>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* ── Lifetime Metrics ─────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="section-title mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-neon-cyan" />
            {t('energy.lifetime.title', 'Lifetime Metrics')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-4">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {t('energy.lifetime.energyUsed', 'Lifetime Energy Used')}
              </p>
              {liveCharging?.lifetime_energy_used != null ? (
                <>
                  <p className="text-2xl font-bold text-cyan-300">
                    {fmtNumber(liveCharging.lifetime_energy_used)}
                    <span className="text-sm font-normal text-[var(--text-muted)] ml-1">kWh</span>
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {t('energy.lifetime.energyUsedDesc', 'Total energy consumed since vehicle delivery')}
                  </p>
                </>
              ) : (
                <p className="text-lg font-semibold text-[var(--text-muted)]">—</p>
              )}
            </div>
            <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] p-4">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {t('energy.lifetime.periodEnergy', { days: periodDays, defaultValue: 'Last {{days}} Days' })}
              </p>
              <p className="text-2xl font-bold text-emerald-300">
                {fmtNumber(totalEnergy)}
                <span className="text-sm font-normal text-[var(--text-muted)] ml-1">kWh</span>
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                {t('energy.lifetime.periodEnergyDesc', 'Energy added during selected date range')}
              </p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Cost vs Gas Savings ───────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FadeIn>
          <CostComparisonCard
            label={t('energy.cost.periodTotal', { days: periodDays, defaultValue: '{{days}}-Day Total' })}
            evCost={totalCost}
            gasCost={gasEquivalent}
            icon={<Fuel className="h-4 w-4" />}
          />
        </FadeIn>
        <FadeIn delay={0.05}>
          <CostComparisonCard
            label={t('energy.cost.projectedAnnual', 'Projected Annual')}
            evCost={yearlyProjectedCost}
            gasCost={(gasEquivalent / periodDays) * 365}
            icon={<Leaf className="h-4 w-4" />}
          />
        </FadeIn>
      </div>

      {/* ── Charts Row 1: Energy & Cost Daily + Efficiency ────
          Phase 40 / Prompt 62: both panels share the same `daily_breakdown`
          dataset (matching `date` axis), so they're wrapped in a single
          `<ChartTimeRangeProvider>` to mirror hover cursors and draw a
          persistent reference line on both at the last hovered date. */}
      <ChartTimeRangeProvider syncId="energy.daily">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.1}>
              {/* chart-a11y:no-table dual-axis composed chart with brush; SR users can use Download CSV via the chart export menu */}
              <ChartContainer
                title={t('energy.chart.energyCostDaily', 'Energy & Cost Daily')}
                ariaLabel={t('energy.chart.energyCostDaily.aria', 'Daily energy and efficiency composed chart with bars and a line')}
                exportable
                exportFilename="energy-cost-daily"
                chartKey="energy-cost-daily"
                annotations={{ vehicleId, scope: 'energy', chartId: 'energy-cost-daily' }}
              >
                {({ annotations: chartAnnotations }) => (
                  <div className="h-48 sm:h-64">
                    {dailyEnergy.length > 0 ? (
                      <EnergyChartSync>
                        {({ sync, syncedX }) => (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                              data={dailyEnergy}
                              syncId={sync.syncId}
                              syncMethod={sync.syncMethod}
                              onMouseMove={sync.onMouseMove}
                            >
                              <defs>
                                <ChartGradient id="energyBarGrad" color="#00f0ff" opacity={0.8} />
                              </defs>
                              {chartGrid}
                              <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                              <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false} />
                              <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false} />
                              <Tooltip content={<ChartTooltip />} />
                              <ChartLegend state={energyCostHidden} />
                              {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                              <Bar
                                yAxisId="left"
                                dataKey="energy_kwh"
                                name={t('energy.chart.energyKwh', 'Energy (kWh)')}
                                fill="url(#energyBarGrad)"
                                fillOpacity={0.6}
                                radius={[3, 3, 0, 0]}
                                animationDuration={800}
                                hide={energyCostHidden.isHidden('energy_kwh')}
                              />
                              <Line
                                {...AREA_DEFAULTS}
                                yAxisId="right"
                                dataKey="efficiency_wh_per_mi"
                                name={efficiencyUnit}
                                stroke="#10b981"
                                animationDuration={800}
                                hide={energyCostHidden.isHidden('efficiency_wh_per_mi')}
                              />
                              {syncedX != null && (
                                <ReferenceLine
                                  yAxisId="left"
                                  x={syncedX}
                                  stroke={chartTokens.cursor.stroke}
                                  strokeWidth={chartTokens.cursor.strokeWidth}
                                  strokeDasharray={chartTokens.cursor.strokeDasharray}
                                  ifOverflow="hidden"
                                  isFront
                                />
                              )}
                              {dailyEnergy.length > 14 && (
                                <Brush
                                  dataKey="date"
                                  height={20}
                                  stroke="#6b7280"
                                  fill="rgba(255,255,255,0.02)"
                                  travellerWidth={8}
                                />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                      </EnergyChartSync>
                    ) : (
                      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                        icon={<Zap className="h-8 w-8" />}
                        message={t('energy.chart.noEnergyData', 'Connect vehicle to see energy data')}
                        className="py-8"
                      />
                    )}
                  </div>
                )}
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.15}>
              {/* chart-a11y:no-table efficiency + distance two-area trend; same daily breakdown is exportable as CSV via the chart menu */}
              <ChartContainer
                title={t('energy.chart.efficiencyTrend', 'Efficiency Trend')}
                ariaLabel={t('energy.chart.efficiencyTrend.aria', 'Daily efficiency and distance area chart')}
                exportable
                exportFilename="efficiency-trend"
              >
                <div className="h-48 sm:h-64">
                  {dailyEnergy.length > 0 ? (
                    <EnergyChartSync>
                      {({ sync, syncedX }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={dailyEnergy}
                            syncId={sync.syncId}
                            syncMethod={sync.syncMethod}
                            onMouseMove={sync.onMouseMove}
                          >
                            <defs>
                              <ChartGradient id="effGrad" color="#10b981" opacity={0.3} />
                              <ChartGradient id="distGrad2" color="#00f0ff" opacity={0.15} />
                            </defs>
                            {chartGrid}
                            <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                            <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                            <Tooltip content={<ChartTooltip />} />
                            <Area
                              {...AREA_DEFAULTS}
                              dataKey="efficiency_wh_per_mi"
                              name={efficiencyUnit}
                              stroke="#10b981"
                              fill="url(#effGrad)"
                              animationDuration={800}
                            />
                            <Area
                              {...AREA_DEFAULTS}
                              dataKey="distance_m"
                              name={t('energy.chart.distance', { unit: distanceUnit, defaultValue: 'Distance ({{unit}})' })}
                              stroke="#00f0ff"
                              fill="url(#distGrad2)"
                              strokeWidth={1}
                              strokeDasharray="4 4"
                              animationDuration={800}
                            />
                            {syncedX != null && (
                              <ReferenceLine
                                x={syncedX}
                                stroke={chartTokens.cursor.stroke}
                                strokeWidth={chartTokens.cursor.strokeWidth}
                                strokeDasharray={chartTokens.cursor.strokeDasharray}
                                ifOverflow="hidden"
                                isFront
                              />
                            )}
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </EnergyChartSync>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Activity className="h-8 w-8" />}
                      message={t('energy.chart.noEfficiencyData', 'No efficiency data yet')}
                      className="py-8"
                    />
                  )}
                </div>
              </ChartContainer>
            </FadeIn>
          </div>
          </ChartTimeRangeProvider>

          {/* ── Charts Row 2: Time of Day + Charger Breakdown ──── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.2}>
              {/* chart-a11y:no-table aggregated time-of-day buckets bar chart; CSV download available */}
              <ChartContainer
                title={t('energy.chart.chargingByTime', 'Charging by Time of Day')}
                ariaLabel={t('energy.chart.chargingByTime.aria', 'Charging energy and session count by time of day bar chart')}
                exportable
                exportFilename="charging-by-time"
              >
                {timeOfDayData.length > 0 ? (
                  <>
                    <div className="h-44 sm:h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={timeOfDayData}>
                          {chartGrid}
                          <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                          <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar
                            dataKey="energy"
                            name={t('energy.chart.energyKwh', 'Energy (kWh)')}
                            fill="#f59e0b"
                            fillOpacity={0.7}
                            radius={[3, 3, 0, 0]}
                            animationDuration={800}
                          />
                          <Bar
                            dataKey="count"
                            name={t('energy.chart.sessions', 'Sessions')}
                            fill="#a855f7"
                            fillOpacity={0.5}
                            radius={[3, 3, 0, 0]}
                            animationDuration={800}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <Moon className="h-3 w-3" /> {t('energy.tip.offPeak', 'Off-peak charging saves money')}
                      </span>
                      <span className="flex items-center gap-1">
                        <Sun className="h-3 w-3" /> {t('energy.tip.solar', 'Solar-optimal: 10am–3pm')}
                      </span>
                    </div>
                  </>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                    icon={<Activity className="h-8 w-8" />}
                    message={t('common.noData', 'No data available')}
                    className="py-8"
                  />
                )}
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.25}>
              {/* chart-a11y:no-table charger-type pie-chart aggregation; CSV download available */}
              <ChartContainer
                title={t('energy.chart.chargerBreakdown', 'Charger Type Breakdown')}
                ariaLabel={t('energy.chart.chargerBreakdown.aria', 'Charger type share pie chart')}
                exportable
                exportFilename="charger-breakdown"
              >
                {chargerBreakdown.length > 0 ? (
                  <div className="flex items-center gap-6">
                    <div className="h-48 w-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chargerBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={70}
                            paddingAngle={3}
                            dataKey="energy"
                          >
                            {chargerBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} stroke="transparent" />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-3">
                      {chargerBreakdown.map((b) => (
                        <div key={b.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.fill }} />
                              <span className="text-[var(--text-secondary)]">{b.name}</span>
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">
                              {b.count} {t('energy.breakdown.sessions', 'sessions')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-cyan-300">{fmtNumber(b.energy ?? 0)} kWh</span>
                            <span className="text-emerald-300"><Currency value={b.cost ?? 0} /></span>
                            <span className="text-[var(--text-muted)]">
                              <Currency value={b.energy > 0 ? b.cost / b.energy : 0} precision={3} />/kWh
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                    icon={<Activity className="h-8 w-8" />}
                    message={t('common.noData', 'No data available')}
                    className="py-8"
                  />
                )}
              </ChartContainer>
            </FadeIn>
          </div>

          {/* ── Recent Charging Sessions ─────────────────────────── */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Zap className="h-4 w-4 text-neon-amber" />
                {t('energy.sessions.title', 'Recent Charging Sessions')}
              </h3>
              {sessions && sessions.length > 0 ? (
                <DataTable
                  tableId="battery:energy-sessions"
                  columns={sessionColumns}
                  data={sessions.slice(0, 15)}
                  keyExtractor={(s) => s.id}
                  pagination
                />
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<Activity className="h-8 w-8" />}
                  message={t('energy.sessions.empty', 'No charging sessions recorded')}
                  className="py-8"
                />
              )}
            </GlassPanel>
          </FadeIn>
    </PageContainer>
  );
}
