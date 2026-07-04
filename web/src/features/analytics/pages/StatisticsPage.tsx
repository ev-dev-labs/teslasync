import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, MapPin, Zap, DollarSign, Leaf, Battery,
  TrendingUp, Gauge, RefreshCw, Car, Clock,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Button, PanelTitle } from '@/components/ui';
import { MetricCard, SavedViewMenu, DataFreshnessAuto } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, ChartContainer, ChartLegend,
  chartGrid, axisTickSm,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, StatGridSkeleton } from '@/components/feedback';
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
import { request } from '@/api/client';

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;
const BATTERY_GAUGE_COLOR = '#10b981';

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

/* ── Page ─────────────────────────────────────────────────────────── */

export default function StatisticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('statistics.title', 'Statistics'));
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `total_distance` and `vehicle_comparison[].distance` are SI km;
  // `avg_efficiency` is SI Wh/km. Convert at the display boundary so values
  // match the user's distance-unit preference.
  // Memoised so the derived `compData`/`stateData` charts keep a stable
  // dependency identity across re-renders (they close over `fromKm`).
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit),
    [distanceUnit],
  );
  const whPerKmToDisplay = useCallback(
    (whPerKm: number) => (distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm),
    [distanceUnit],
  );
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

  // Reactive chart palette: color-blind safe or neon per user preference.
  const palette = useChartPalette();

  // Persist hidden series in the URL so users can isolate one fleet metric
  // across the multi-vehicle distance/energy bar chart.
  const fleetCompareHidden = useHiddenSeries('fleet-vehicle-comparison');

  /* ── Data hooks ────────────────────────────────────────────────── */
  const statsQuery = useQuery({
    queryKey: ['period-stats', activeId],
    queryFn: () => request<PeriodStats>(`/analytics/period-stats?vehicle_id=${activeId}`),
    enabled: !!activeId,
  });
  const { data: stats, isLoading: statsLoading, error: statsError, refetch } = statsQuery;

  const { data: batteryHealth, isLoading: batteryLoading, error: batteryError } =
    useBatteryHealthAnalytics(activeId || null);
  const { data: mileage, isLoading: mileageLoading, error: mileageError } = useMileageStats(activeId);
  const { data: stateSummary, isLoading: stateLoading } = useStateSummary(activeId);
  const { data: fleet, isLoading: fleetLoading, error: fleetError } =
    useFleetAnalytics({ start: startDate, end: endDate });

  /* ── Derived ───────────────────────────────────────────────────── */
  const avgDriveDistance = stats && stats.total_drives > 0
    ? (stats.total_distance ?? 0) / stats.total_drives : 0;

  const stateData = useMemo(() => {
    if (!stateSummary?.length) return [];
    // Backend (deleted) returned `total_min`; the legacy camelCase wrapper
    // surfaced `totalMin`. Reading both via fallback keeps the empty-state
    // correct even if a future replacement endpoint emits snake_case.
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

  /* ── Toolbar ───────────────────────────────────────────────────── */
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {vehicles.length > 0 && (
        <Select
          value={activeId}
          onChange={(e) => onPickVehicle(e.target.value)}
          options={vehicleOptions}
          placeholder={t('statistics.selectVehicle', 'Select Vehicle')}
          aria-label={t('statistics.selectVehicle', 'Select Vehicle')}
        />
      )}
      <RangePicker
        value={{ start: startDate, end: endDate }}
        onChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
        align="end"
        triggerTestId="statistics-range"
      />
      <Button
        size="sm"
        onClick={() => { void refetch(); }}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <SavedViewMenu
        route="/statistics"
        currentQuery={savedView.currentQuery}
        onApply={savedView.apply}
      />
      <DataFreshnessAuto query={statsQuery} />
    </div>
  );

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('statistics.title', 'Statistics')}
      subtitle={t('statistics.subtitle', 'Lifetime vehicle statistics and records')}
      actions={actions}
    >
      {/* 1 — Period totals + averages (both derived from period-stats) */}
      <FadeIn>
        {statsLoading ? (
          <div className="space-y-3 sm:space-y-4">
            <StatGridSkeleton cards={5} className="sm:grid-cols-3 lg:grid-cols-5" />
            <StatGridSkeleton cards={3} className="grid-cols-1 sm:grid-cols-3" />
          </div>
        ) : statsError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={statsError} onRetry={() => { void refetch(); }} />
          </GlassPanel>
        ) : !stats ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
              icon={<BarChart3 className="h-10 w-10" aria-hidden="true" />}
              title={t('statistics.noData', 'No Data')}
              message={t('statistics.noDataMsg', 'No statistics available for this vehicle.')}
            />
          </GlassPanel>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            <section
              aria-label={t('statistics.title', 'Statistics')}
              className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-5"
            >
              <MetricCard label={t('statistics.totalDistance', 'Total Distance')} value={`${fmtInt(fromKm(stats.total_distance ?? 0))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.totalDrives', 'Total Drives')} value={fmtInt(stats.total_drives ?? 0)} icon={<TrendingUp className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.totalEnergy', 'Total Energy')} value={`${fmtNumber(stats.energy_used ?? 0)} kWh`} icon={<Zap className="h-4 w-4" />} color="amber" />
              <MetricCard label={t('statistics.totalCost', 'Total Cost')} value={formatCurrency(stats.total_cost ?? 0, 0)} icon={<DollarSign className="h-4 w-4" />} color="red" />
              <MetricCard label={t('statistics.co2Saved', 'CO₂ Saved')} value={`${fmtNumber(stats.co2_saved ?? 0)} kg`} icon={<Leaf className="h-4 w-4" />} color="green" />
            </section>
            <section
              aria-label={t('statistics.averages', 'Averages')}
              className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3"
            >
              <MetricCard label={t('statistics.avgDriveDistance', 'Avg Drive Distance')} value={`${fmtNumber(fromKm(avgDriveDistance))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('statistics.avgEfficiency', 'Avg Efficiency')} value={`${fmtNumber(whPerKmToDisplay(stats.avg_efficiency ?? 0))} ${efficiencyUnit}`} icon={<Gauge className="h-4 w-4" />} color="green" />
              <MetricCard label={t('statistics.costPerKm', 'Cost per km')} value={(stats.total_distance ?? 0) > 0 ? formatCurrency((stats.total_cost ?? 0) / stats.total_distance, 3) : '—'} icon={<DollarSign className="h-4 w-4" />} color="amber" />
            </section>
          </div>
        )}
      </FadeIn>

      {/* 2 — Battery Health (hero) + State Distribution bento */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Battery className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('statistics.batteryHealth', 'Battery Health')}
            </PanelTitle>
            {batteryLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : batteryError ? (
              <QueryError error={batteryError} />
            ) : batteryHealth ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-center">
                <div className="flex justify-center">
                  <RadialGauge
                    value={Math.round(batteryHealth.current_soh ?? 0)}
                    max={100}
                    label={t('statistics.health', 'Health')}
                    unit="%"
                    color={BATTERY_GAUGE_COLOR}
                    size={140}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard label={t('statistics.capacity', 'Capacity')} value={`${fmtNumber(batteryHealth.estimated_capacity ?? 0, 1)} kWh`} icon={<Battery className="h-4 w-4" />} color="cyan" />
                  <MetricCard label={t('statistics.degradation', 'Degradation')} value={`${fmtNumber(batteryHealth.degradation_rate_yr ?? 0, 2)}%/yr`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
                  <MetricCard label={t('statistics.cycles', 'Cycles')} value={fmtInt(batteryHealth.total_cycles ?? 0)} icon={<RefreshCw className="h-4 w-4" />} color="purple" />
                  <MetricCard label={t('statistics.age', 'Age')} value={`${batteryHealth.battery_age_months ?? 0} mo`} icon={<Clock className="h-4 w-4" />} color="green" />
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Battery className="h-8 w-8" aria-hidden="true" />}
                message={t('statistics.noBattery', 'No battery health data available')}
                className="py-8"
              />
            )}
          </GlassPanel>

          {/* chart-a11y:no-table pie-chart slices are aggregated state counts; SR users get the same info via the State page */}
          <ChartContainer
            title={t('statistics.stateDistribution', 'State Distribution')}
            ariaLabel={t('statistics.stateDistribution.aria', 'Vehicle state distribution pie chart')}
            exportable
            exportFilename="state-distribution"
            height={280}
            className="xl:col-span-1"
          >
            {stateLoading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : stateData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stateData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3}>
                    {stateData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Legend />
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Clock className="h-8 w-8" aria-hidden="true" />}
                message={t('statistics.noStates', 'No state distribution data')}
                className="py-8"
              />
            )}
          </ChartContainer>
        </section>
      </FadeIn>

      {/* 3 — Mileage Summary + Vehicle Comparison (hero) bento */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('statistics.mileage', 'Mileage Summary')}
            </PanelTitle>
            {mileageLoading ? (
              <Skeleton className="h-40 rounded-xl" />
            ) : mileageError ? (
              <QueryError error={mileageError} />
            ) : mileage ? (
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label={t('statistics.totalMileage', 'Total Distance')} value={`${fmtInt(fromKm(mileage.lifetime_km ?? 0))} ${distanceUnit}`} icon={<MapPin className="h-4 w-4" />} color="cyan" />
                <MetricCard label={t('statistics.dailyAvg', 'Daily Average')} value={`${fmtNumber(fromKm((mileage.last_30d_km ?? 0) / 30))} ${distanceUnit}`} icon={<Car className="h-4 w-4" />} color="green" />
                <MetricCard label={t('statistics.totalDrives', 'Total Drives')} value={fmtInt(mileage.drive_count_lifetime ?? 0)} icon={<Clock className="h-4 w-4" />} color="purple" />
                <MetricCard label={t('statistics.yearlyProjection', 'Yearly Projection')} value={`${fmtInt(fromKm(((mileage.last_30d_km ?? 0) / 30) * 365))} ${distanceUnit}`} icon={<TrendingUp className="h-4 w-4" />} color="amber" />
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Car className="h-8 w-8" aria-hidden="true" />}
                message={t('statistics.noMileage', 'No mileage data available')}
                className="py-8"
              />
            )}
          </GlassPanel>

          {/* chart-a11y:no-table multi-vehicle bar chart — fleet rollup with per-vehicle drill-down available */}
          <ChartContainer
            title={t('statistics.vehicleComparison', 'Vehicle Comparison')}
            ariaLabel={t('statistics.vehicleComparison.aria', 'Distance and energy bar chart comparing all vehicles in the fleet')}
            chartKey="fleet-vehicle-comparison"
            exportable
            exportFilename="vehicle-comparison"
            height={300}
            className="xl:col-span-2"
          >
            {fleetLoading ? (
              <Skeleton className="h-full w-full rounded-xl" />
            ) : fleetError ? (
              <QueryError error={fleetError} />
            ) : compData.length > 1 ? (
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
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Car className="h-8 w-8" aria-hidden="true" />}
                message={t('statistics.singleVehicle', 'Add more vehicles to compare')}
                className="py-8"
              />
            )}
          </ChartContainer>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
