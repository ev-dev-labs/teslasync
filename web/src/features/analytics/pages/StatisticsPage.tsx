import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, MapPin, Zap, DollarSign, Leaf, Battery,
  TrendingUp, Gauge, RefreshCw, Car, Clock,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Select, Button } from '@/components/ui';
import { MetricCard, SavedViewMenu, DataFreshnessAuto } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, ChartContainer, ChartLegend,
  chartGrid, axisTickSm,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, ChartBlockSkeleton, StatGridSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker } from '@/components/forms';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useFleetAnalytics, useMileageStats, useStateSummary } from '@/api/hooks/useAnalytics';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlString } from '@/hooks/useUrlState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;

/* ── Types ────────────────────────────────────────────────────────── */

interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
  parked: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  idle: '#a855f7',
};

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the StatisticsPage layout while data loads:
 * 5 period-stat cards → 3 averages → 1 battery-health panel →
 * 2 side-by-side panels (state + mileage) → 1 vehicle-comparison chart.
 * Phase-45 / Prompt 18.
 */
function StatisticsSkeleton() {
  return (
    <div className="space-y-6" data-testid="statistics-skeleton">
      <StatGridSkeleton cards={5} className="sm:grid-cols-3 lg:grid-cols-5" />
      <StatGridSkeleton cards={3} className="grid-cols-1 sm:grid-cols-3 md:grid-cols-3" />
      <Skeleton className="h-56 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartBlockSkeleton height={280} />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <ChartBlockSkeleton height={320} />
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function StatisticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('statistics.title', 'Statistics'));
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `total_distance` and `vehicle_comparison[].distance` are SI km;
  // `avg_efficiency` is SI Wh/km. Convert at boundary so display matches the
  // user's distance unit pref.
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
  const whPerKmToDisplay = (whPerKm: number) =>
    distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const savedView = useSavedViewUrl();

  const [, setUrlVehicleId] = useUrlString('vehicle_id', '');
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
      setUrlVehicleId(id);
    }
  };

  const defaultStart = useMemo(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [startDate] = useUrlString('from', defaultStart);
  const [endDate] = useUrlString('to', defaultEnd);
  const setRangeBatch = useUrlBatch();

  // Phase-45/23 — reactive chart palette (CB-safe / neon per user pref).
  const palette = useChartPalette();

  // Phase-46 / Prompt 67 — URL-persisted hidden-series state for the
  // multi-vehicle distance/energy bar chart so users can isolate one
  // metric across the fleet.
  const fleetCompareHidden = useHiddenSeries('fleet-vehicle-comparison');

  /* ── Data hooks ────────────────────────────────────────────────── */
  const statsQuery = useQuery({
    queryKey: ['period-stats', activeId],
    queryFn: () => request<PeriodStats>(`/analytics/period-stats?vehicle_id=${activeId}`),
    enabled: !!activeId,
  });
  const { data: stats, isLoading, error, refetch } = statsQuery;

  const { data: batteryHealth } = useBatteryHealthAnalytics(activeId || null);
  const { data: mileage } = useMileageStats(activeId);
  const { data: stateSummary } = useStateSummary(activeId);
  const { data: fleet } = useFleetAnalytics(30, startDate);

  /* ── Derived ───────────────────────────────────────────────────── */
  const avgDriveDistance = stats && stats.total_drives > 0
    ? stats.total_distance / stats.total_drives : 0;

  const stateData = useMemo(() => {
    if (!stateSummary?.length) return [];
    // Backend (deleted) returned `total_min`; legacy camelCase wrapper
    // surfaced `totalMin`. Reading both via fallback keeps the empty-state
    // banner correct even if a future replacement endpoint emits snake_case.
    const total = stateSummary.reduce((s, e) => {
      const minutes = (e as { totalMin?: number; total_min?: number }).totalMin
        ?? (e as { total_min?: number }).total_min ?? 0;
      return s + minutes;
    }, 0);
    return stateSummary.map((e) => {
      const minutes = (e as { totalMin?: number; total_min?: number }).totalMin
        ?? (e as { total_min?: number }).total_min ?? 0;
      return {
        name: e.state,
        value: Math.round((minutes / Math.max(total, 1)) * 100),
        fill: STATE_COLORS[e.state] ?? palette[5],
      };
    });
  }, [stateSummary, palette]);

  const compData = useMemo(() => {
    if (!fleet?.vehicle_comparison) return [];
    return fleet.vehicle_comparison.map((v) => ({
      name: v.name ?? `Vehicle ${v.id}`,
      distance: Math.round(fromKm(v.distance)),
      energy: Math.round(v.energy),
    }));
  }, [fleet, fromKm]);

  const vehicleOptions = vehicles.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('statistics.title', 'Statistics')}
      subtitle={t('statistics.subtitle', 'Lifetime vehicle statistics and records')}
      error={error as Error | null}
      actions={
        <div className={cn('flex flex-wrap items-center gap-2')}>
          {vehicles.length > 0 && (
            <Select value={activeId} onChange={(e) => onPickVehicle(e.target.value)} options={vehicleOptions} />
          )}
          <RangePicker value={{ start: startDate, end: endDate }} onChange={(r) => setRangeBatch({ from: r.start, to: r.end })} align="end" triggerTestId="statistics-range" />
          <Button size="sm" onClick={() => { void refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <SavedViewMenu
            route="/statistics"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
          <DataFreshnessAuto query={statsQuery} />
        </div>
      }
    >
      {isLoading ? (
        <StatisticsSkeleton />
      ) : !stats ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<BarChart3 className="h-10 w-10" />} title={t('statistics.noData', 'No Data')} message={t('statistics.noDataMsg', 'No statistics available for this vehicle.')} />
      ) : (
        <>
          {/* ── Period Stats ──────────────────────────────────── */}
          <FadeIn>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard label={t('statistics.totalDistance', 'Total Distance')} value={`${fmtInt(fromKm(stats.total_distance))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.totalDrives', 'Total Drives')} value={fmtInt(stats.total_drives)} icon={<TrendingUp className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.totalEnergy', 'Total Energy')} value={`${fmtNumber(stats.energy_used)} kWh`} icon={<Zap className="h-4 w-4" />} color="amber" />
              <MetricCard label={t('statistics.totalCost', 'Total Cost')} value={formatCurrency(stats.total_cost, 0)} icon={<DollarSign className="h-4 w-4" />} color="red" />
              <MetricCard label={t('statistics.co2Saved', 'CO₂ Saved')} value={`${fmtNumber(stats.co2_saved)} kg`} icon={<Leaf className="h-4 w-4" />} color="green" />
            </div>
          </FadeIn>

          {/* ── Averages ─────────────────────────────────────── */}
          <FadeIn delay={0.05}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard label={t('statistics.avgDriveDistance', 'Avg Drive Distance')} value={`${fmtNumber(fromKm(avgDriveDistance))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.avgEfficiency', 'Avg Efficiency')} value={`${fmtNumber(whPerKmToDisplay(stats.avg_efficiency))} ${efficiencyUnit}`} icon={<Gauge className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.costPerKm', 'Cost per km')} value={stats.total_distance > 0 ? formatCurrency(stats.total_cost / stats.total_distance, 3) : '—'} icon={<DollarSign className="h-4 w-4" />} color="amber" />
            </div>
          </FadeIn>

          {/* ── Battery Health ────────────────────────────────── */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
                {t('statistics.batteryHealth', 'Battery Health')}
              </h2>
              {batteryHealth ? (
                <Grid cols={{ default: 1, md: 2 }} gap={4}>
                  <div className="flex justify-center">
                    <RadialGauge value={Math.round(batteryHealth.current_soh)} max={100} label={t('statistics.health', 'Health')} unit="%" color="#10b981" size={140} />
                  </div>
                  <Grid cols={{ default: 2 }} gap={3}>
                    <MetricCard label={t('statistics.capacity', 'Capacity')} value={`${fmtNumber(batteryHealth.estimated_capacity, 1)} kWh`} icon={<Battery className="h-4 w-4" />} color="cyan" />
                    <MetricCard label={t('statistics.degradation', 'Degradation')} value={`${fmtNumber(batteryHealth.degradation_rate_yr, 2)}%/yr`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
                    <MetricCard label={t('statistics.cycles', 'Cycles')} value={fmtInt(batteryHealth.total_cycles)} icon={<RefreshCw className="h-4 w-4" />} color="purple" />
                    <MetricCard label={t('statistics.age', 'Age')} value={`${batteryHealth.battery_age_months} mo`} icon={<Clock className="h-4 w-4" />} color="green" />
                  </Grid>
                </Grid>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Battery className="h-8 w-8" />} message={t('statistics.noBattery', 'No battery health data available')} className="py-8" />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── State Distribution + Mileage ──────────────────── */}
          <FadeIn delay={0.15}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* State Distribution PieChart */}
              {/* chart-a11y:no-table pie-chart slices are aggregated state counts; SR users get the same info via the State page */}
              <ChartContainer
                title={t('statistics.stateDistribution', 'State Distribution')}
                ariaLabel={t('statistics.stateDistribution.aria', 'Vehicle state distribution pie chart')}
                exportable
                exportFilename="state-distribution"
              >
                {stateData.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={stateData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3}>
                          {stateData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Pie>
                        <Legend />
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Clock className="h-8 w-8" />} message={t('statistics.noStates', 'No state distribution data')} className="py-8" />
                )}
              </ChartContainer>

              {/* Mileage Summary */}
              <GlassPanel className="p-6">
                <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
                  {t('statistics.mileage', 'Mileage Summary')}
                </h2>
                {mileage ? (
                  <Grid cols={{ default: 2 }} gap={3}>
                    <MetricCard label={t('statistics.totalMileage', 'Total Distance')} value={`${fmtInt(fromKm(mileage.totalDistance))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
                    <MetricCard label={t('statistics.dailyAvg', 'Daily Average')} value={`${fmtNumber(fromKm(mileage.avgDaily))} ${distanceUnit}`} icon={<Car className="h-4 w-4" />} color="green" />
                    <MetricCard label={t('statistics.daysTracked', 'Days Tracked')} value={fmtInt(mileage.daysTracked)} icon={<Clock className="h-4 w-4" />} color="purple" />
                    <MetricCard label={t('statistics.yearlyProjection', 'Yearly Projection')} value={`${fmtInt(fromKm(mileage.avgDaily * 365))} ${distanceUnit}`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
                  </Grid>
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Car className="h-8 w-8" />} message={t('statistics.noMileage', 'No mileage data available')} className="py-8" />
                )}
              </GlassPanel>
            </div>
          </FadeIn>

          {/* ── Vehicle Comparison ────────────────────────────── */}
          <FadeIn delay={0.2}>
            {/* chart-a11y:no-table multi-vehicle bar chart — fleet rollup with per-vehicle drill-down available */}
            <ChartContainer
              title={t('statistics.vehicleComparison', 'Vehicle Comparison')}
              ariaLabel={t('statistics.vehicleComparison.aria', 'Distance and energy bar chart comparing all vehicles in the fleet')}
              chartKey="fleet-vehicle-comparison"
              exportable
              exportFilename="vehicle-comparison"
            >
              {compData.length > 1 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compData}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend state={fleetCompareHidden} />
                      <Bar dataKey="distance" name={`${t('statistics.distance', 'Distance')} (${distanceUnit})`} fill={palette[0]} radius={[4, 4, 0, 0]} hide={fleetCompareHidden.isHidden('distance')} />
                      <Bar dataKey="energy" name={t('statistics.energy', 'Energy (kWh)')} fill={palette[1]} radius={[4, 4, 0, 0]} hide={fleetCompareHidden.isHidden('energy')} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Car className="h-8 w-8" />} message={t('statistics.singleVehicle', 'Add more vehicles to compare')} className="py-8" />
              )}
            </ChartContainer>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
