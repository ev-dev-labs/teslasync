import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, Car, Plug, Thermometer, Cpu,
  ArrowRight, ArrowDown, Zap,
  TrendingUp, Activity, BarChart3,
  Leaf, Calendar, Gauge,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, DataTable, useSortToggle, type Column,
  PanelTitle, Text, Caption, Label, MetricValue,
} from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, ChartGradient,
  chartGrid, axisTick, chartMarginLabeled, chartAnimation, CHART_COLORS,
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useRangeState } from '@/hooks/useRangeState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { convertDistanceFromSI, convertEnergyFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { useEnergyStats, useEnergyFlow } from '@/api/hooks/useEnergy';
import type { DailyEnergy, EnergyFlowData } from '@/types/energy';

/* ───────── Constants ───────── */

const PRESET_IDS = ['today', '7d', '30d', '90d', 'mtd', 'ytd'];

/** Universal "value unknown" placeholder (shared across the app). */
const DASH = '—';

/* ───────── Pure display helpers (exported for unit tests) ───────── */

/** One point in the daily energy + distance charts. Every value is already in
 *  the user's DISPLAY units — energy in kWh, distance in km|mi — so the charts,
 *  the KPI band and the history table never disagree about what a number means. */
export interface DailyChartPoint {
  date: string;
  /** Daily energy in kWh (converted from the SI watt-hours the API returns). */
  energy: number;
  /** Daily distance in the user's display unit (converted from SI metres). */
  distance: number;
}

/** One point in the daily-efficiency chart. */
export interface EfficiencyChartPoint {
  date: string;
  /** Efficiency in Wh per display distance unit (Wh/km or Wh/mi). */
  efficiency: number;
}

/** Efficiency rating bucket, unit-aware. Lower Wh-per-distance is better. */
export type EfficiencyRating = 'none' | 'excellent' | 'good' | 'high';

/**
 * Convert an efficiency figure from SI (watt-hours per metre) to the user's
 * display unit (watt-hours per km or per mile), rounded to a whole number.
 *
 * `Wh/displayUnit = Wh/m × (metres per displayUnit)`; "metres per displayUnit"
 * is derived from the canonical lib converter (`1 / metres→unit`) so no distance
 * factor is hardcoded here (see unit-conversion.instructions.md). Null/undefined
 * inputs fall back to 0 rather than producing NaN.
 */
export function scaleEfficiency(
  whPerMeter: number | null | undefined,
  distanceUnit: DistanceUnitPref,
): number {
  const perMeter = whPerMeter ?? 0;
  const metersPerUnit = 1 / convertDistanceFromSI(1, distanceUnit);
  return Math.round(perMeter * metersPerUnit);
}

/**
 * Bucket an already-scaled average efficiency into a rating for badge display.
 * Non-positive / non-finite values (no data yet) map to `'none'`.
 */
export function efficiencyRating(
  avgEfficiency: number,
  distanceUnit: DistanceUnitPref,
): EfficiencyRating {
  if (!(avgEfficiency > 0)) return 'none';
  const excellent = distanceUnit === 'km' ? 150 : 240;
  const good = distanceUnit === 'km' ? 200 : 320;
  if (avgEfficiency < excellent) return 'excellent';
  if (avgEfficiency < good) return 'good';
  return 'high';
}

/** Total instantaneous charge power (kW) = DC + AC, null-safe. */
export function computeChargePower(flow: EnergyFlowData | null | undefined): number {
  return (flow?.dc_charging_power ?? 0) + (flow?.ac_charging_power ?? 0);
}

/** Build the daily energy + distance chart series in the user's display units. */
export function buildDailyChartData(
  rows: readonly DailyEnergy[],
  distanceUnit: DistanceUnitPref,
): DailyChartPoint[] {
  return rows.map((d) => ({
    date: formatDateShort(d.date),
    energy: convertEnergyFromSI(d.energy_wh ?? 0, 'kWh'),
    distance: convertDistanceFromSI(d.distance_m ?? 0, distanceUnit),
  }));
}

/** Build the daily-efficiency chart series, dropping days without a value. */
export function buildEfficiencyChartData(
  rows: readonly DailyEnergy[],
  distanceUnit: DistanceUnitPref,
): EfficiencyChartPoint[] {
  return rows
    .filter((d) => (d.efficiency_wh_per_m ?? 0) > 0)
    .map((d) => ({
      date: formatDateShort(d.date),
      efficiency: scaleEfficiency(d.efficiency_wh_per_m, distanceUnit),
    }));
}

/* ───────── Flow diagram building blocks (local, non-exported) ───────── */

/** A directional power chip between two flow nodes. Arrow flips from vertical
 *  (stacked, mobile) to horizontal (row, ≥sm). Colour is data-driven, so the
 *  inline style is a sanctioned dynamic value, not a static token. */
function FlowConnector({
  label,
  value,
  color,
  active,
}: {
  label: string;
  value: string;
  color: string;
  active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Label>{label}</Label>
      <div
        className={cn(
          'flex items-center gap-1 rounded-full px-3 py-1 transition-opacity',
          !active && 'opacity-30',
        )}
        style={{
          backgroundColor: `${color}18`,
          color,
          boxShadow: active ? `0 0 12px ${color}40` : undefined,
        }}
      >
        <ArrowDown className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
        <ArrowRight className="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
        <Text size="xs" weight="semibold">{value}</Text>
      </div>
    </div>
  );
}

/** A node (Grid / Battery / Motor) in the live energy-flow diagram. */
function FlowNode({
  icon,
  label,
  glow = 'none',
  dimmed = false,
  children,
  sublabel,
}: {
  icon: ReactNode;
  label: string;
  glow?: 'cyan' | 'green' | 'purple' | 'none';
  dimmed?: boolean;
  children?: ReactNode;
  sublabel?: string;
}) {
  return (
    <GlassPanel
      hover
      glow={glow}
      className={cn('flex flex-col items-center gap-2 p-4 text-center', dimmed && 'opacity-50')}
    >
      {icon}
      <Text size="xs" weight="medium" color="secondary">{label}</Text>
      {children}
      {sublabel ? <Caption>{sublabel}</Caption> : null}
    </GlassPanel>
  );
}

/** One row in the live-power breakdown side panel. */
function LivePowerRow({
  icon,
  label,
  value,
  valueClass,
  dimmed = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  dimmed?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2',
        dimmed && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <Caption>{label}</Caption>
      </div>
      <Text size="sm" weight="semibold" className={valueClass ?? 'text-[var(--text-primary)]'}>
        {value}
      </Text>
    </div>
  );
}

/** One tile in the efficiency-metrics side panel: value + status chip. */
function EfficiencyStat({
  label,
  value,
  valueClass,
  badge,
}: {
  label: string;
  value: string;
  valueClass: string;
  badge: ReactNode;
}) {
  return (
    <GlassPanel className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <Caption>{label}</Caption>
        <MetricValue className={cn('mt-0.5', valueClass)}>{value}</MetricValue>
      </div>
      {badge}
    </GlassPanel>
  );
}

/* ───────── Section state wrapper ───────── */

/** Renders a data section's own loading / error / empty / no-vehicle state so
 *  no section is gated behind a single page-level guard. */
function SectionState({
  noVehicle,
  loading,
  error,
  empty,
  noVehicleMessage,
  emptyMessage,
  onRetry,
  skeletonHeight = 220,
  children,
}: {
  noVehicle: boolean;
  loading: boolean;
  error: unknown;
  empty: boolean;
  noVehicleMessage: string;
  emptyMessage: string;
  onRetry?: () => void;
  skeletonHeight?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (noVehicle) {
    return (
      <EmptyState
        icon={<Car className="h-8 w-8" />}
        message={noVehicleMessage}
        actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }}
      />
    );
  }
  if (loading) return <Skeleton height={skeletonHeight} rounded />;
  if (error) return <QueryError error={error} onRetry={onRetry} />;
  if (empty) {
    return (
      <EmptyState
        /* no-action: transient — this section's energy series accumulates as telemetry streams
           in; there is no manual trigger to backfill it faster. */
        icon={<Zap className="h-8 w-8" />}
        message={emptyMessage}
      />
    );
  }
  return <>{children}</>;
}

/* ───────── Main Page ───────── */

export default function EnergyFlowPage() {
  const { t } = useTranslation();
  usePageTitle(t('energyFlow.title', 'Energy Flow'));

  const { vehicleId } = useSelectedVehicle();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const { start, end, setRange } = useRangeState({
    persistKey: 'energy-flow.range',
    defaultPresetId: '7d',
  });

  // Backend accepts a trailing `?days=N` window. Compute the inclusive day
  // count from the picker; `presetsOnly` hides the calendar so custom windows
  // that don't end today can't imply a precision the API doesn't honour.
  const days = useMemo(() => {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  }, [start, end]);

  const activeId = vehicleId != null ? String(vehicleId) : null;
  const noVehicle = activeId == null;

  // Historical stats — GET /vehicles/{id}/energy?days=N
  const statsQuery = useEnergyStats(activeId, days);
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = statsQuery;

  // Real-time flow — GET /vehicles/{id}/energy/flow
  const flowQuery = useEnergyFlow(activeId);
  const { data: flow, isLoading: flowLoading, error: flowError, refetch: refetchFlow } = flowQuery;

  /* ─── Derived: real-time flow ─── */
  const chargePower = computeChargePower(flow);
  const batterySOC = flow?.soc ?? 0;
  const chargeState = flow?.charge_state ?? null;

  /* ─── Derived: daily chart data ─── */
  const dailyBreakdown: DailyEnergy[] = stats?.daily_breakdown ?? [];

  const dailyChartData = useMemo(
    () => buildDailyChartData(dailyBreakdown, distanceUnit),
    [dailyBreakdown, distanceUnit],
  );

  const efficiencyChartData = useMemo(
    () => buildEfficiencyChartData(dailyBreakdown, distanceUnit),
    [dailyBreakdown, distanceUnit],
  );

  /* ─── Derived: stat values with unit conversion ─── */
  const totalDistance = stats ? formatDistance(stats.total_distance_m ?? 0) : DASH;

  const avgEfficiency = useMemo(
    () => scaleEfficiency(stats?.avg_efficiency_wh_per_m, distanceUnit),
    [stats, distanceUnit],
  );

  const efficiencyUnit = distanceUnit === 'km' ? t('energyFlow.units.whPerKm', 'Wh/km') : t('energyFlow.units.whPerMi', 'Wh/mi');

  const avgEnergyPerDay = useMemo(() => {
    const period = stats?.period_days ?? 0;
    return period > 0 ? (stats?.total_energy_used_wh ?? 0) / period : 0;
  }, [stats]);

  // Efficiency rating (unit-aware): lower Wh per unit distance is better.
  const rating = efficiencyRating(avgEfficiency, distanceUnit);
  const effVariant =
    rating === 'excellent' ? 'success'
      : rating === 'good' ? 'warning'
        : rating === 'high' ? 'danger'
          : 'neutral';
  const effLabel =
    rating === 'excellent' ? t('energyFlow.efficiency.excellent', 'Excellent')
      : rating === 'good' ? t('energyFlow.efficiency.good', 'Good')
        : rating === 'high' ? t('energyFlow.efficiency.high', 'High')
          : t('energyFlow.efficiency.noData', 'No Data');

  /* ─── Table ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('date', 'desc');

  const sortedDailyRows = useMemo(() => {
    const rows = dailyBreakdown.slice();
    return sortFn(rows, (row, key) => {
      if (key === 'energy_wh') return row.energy_wh ?? 0;
      if (key === 'distance_m') return row.distance_m ?? 0;
      if (key === 'efficiency_wh_per_m') return row.efficiency_wh_per_m ?? 0;
      return row.date;
    });
  }, [dailyBreakdown, sortFn]);

  const historyColumns: Column<DailyEnergy>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('energyFlow.table.date', 'Date'),
        sortable: true,
        render: (row) => <Text variant="bodySm">{formatDateShort(row.date)}</Text>,
      },
      {
        key: 'energy_wh',
        header: t('energyFlow.table.energy', 'Energy'),
        sortable: true,
        render: (row) => (
          <Text size="sm" weight="semibold" mono color="primary">
            {formatEnergy(row.energy_wh ?? 0)}
          </Text>
        ),
      },
      {
        key: 'distance_m',
        header: `${t('energyFlow.table.distance', 'Distance')} (${distanceUnit})`,
        sortable: true,
        render: (row) => (
          <Text size="sm" mono color="primary">{formatDistance(row.distance_m ?? 0)}</Text>
        ),
      },
      {
        key: 'efficiency_wh_per_m',
        header: efficiencyUnit,
        sortable: true,
        render: (row) => (
          <Text size="sm" mono color="primary">
            {fmtNumber(scaleEfficiency(row.efficiency_wh_per_m, distanceUnit), 0)}
          </Text>
        ),
      },
    ],
    [t, distanceUnit, efficiencyUnit, formatDistance, formatEnergy],
  );

  /* ───── Vehicle & Range Controls ───── */

  const actions = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <VehicleSelect />
      <RangePicker
        value={{ start, end }}
        onChange={(r) => setRange(r)}
        presetIds={PRESET_IDS}
        presetsOnly
        align="end"
        triggerTestId="energy-flow-range"
      />
    </div>
  );

  const noVehicleMsg = t('energyFlow.noVehicle', 'Select a vehicle to view its energy flow.');

  /* ───── Main render ───── */

  return (
    <PageContainer
      title={t('energyFlow.title', 'Energy Flow')}
      subtitle={t('energyFlow.subtitle', 'Power distribution and energy analysis')}
      actions={actions}
      query={[statsQuery, flowQuery]}
    >
      {/* ── 1 — KPI band: full-width responsive metric grid ── */}
      <FadeIn>
        <section
          aria-label={t('energyFlow.kpis', 'Energy summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6"
        >
          <MetricCard
            label={t('energyFlow.kpi.totalEnergy', 'Total Energy')}
            value={stats ? formatEnergy(stats.total_energy_used_wh ?? 0) : DASH}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('energyFlow.kpi.totalCharged', 'Total Charged')}
            value={stats ? formatEnergy(stats.total_energy_charged_wh ?? 0) : DASH}
            icon={<Plug className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('energyFlow.kpi.distance', 'Distance')}
            value={totalDistance}
            icon={<Car className="h-4 w-4" />}
            color="purple"
            subtitle={distanceUnit}
          />
          <MetricCard
            label={t('energyFlow.kpi.efficiency', 'Efficiency')}
            value={stats ? avgEfficiency : DASH}
            icon={<Gauge className="h-4 w-4" />}
            color="amber"
            subtitle={efficiencyUnit}
          />
          <MetricCard
            label={t('energyFlow.kpi.co2Saved', 'CO₂ Saved')}
            value={stats ? fmtNumber(stats.co2_saved_kg ?? 0, 1) : DASH}
            icon={<Leaf className="h-4 w-4" />}
            color="green"
            subtitle={t('energyFlow.units.kg', 'kg')}
          />
          <MetricCard
            label={t('energyFlow.kpi.period', 'Period')}
            value={stats ? String(stats.period_days ?? 0) : DASH}
            icon={<Calendar className="h-4 w-4" />}
            color="blue"
            subtitle={t('energyFlow.units.days', 'days')}
          />
        </section>
      </FadeIn>

      {/* ── 2 — Live energy flow hero + live power breakdown ── */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Hero: real-time flow diagram (Grid → Battery → Motor) */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <PanelTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('energyFlow.diagram.title', 'Energy Flow Diagram')}
              </PanelTitle>
              {chargeState ? (
                <Badge variant={chargeState === 'Charging' ? 'success' : 'neutral'} size="sm">
                  {t(chargeState)}
                </Badge>
              ) : null}
            </div>

            <SectionState
              noVehicle={noVehicle}
              loading={flowLoading}
              error={flowError}
              empty={false}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.diagram.noData', 'No live flow data available.')}
              onRetry={() => refetchFlow()}
              skeletonHeight={200}
            >
              <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-5">
                <FlowNode
                  glow="green"
                  icon={<Plug className="h-8 w-8" style={{ color: CHART_COLORS[1] }} aria-hidden="true" />}
                  label={t('energyFlow.node.grid', 'Grid')}
                />

                <FlowConnector
                  label={t('energyFlow.node.charging', 'Charging')}
                  value={`${fmtNumber(chargePower, 1)} ${t('energyFlow.units.kw', 'kW')}`}
                  color={CHART_COLORS[1]}
                  active={Math.abs(chargePower) > 0.01}
                />

                <FlowNode
                  glow="cyan"
                  icon={<Battery className="h-8 w-8" style={{ color: CHART_COLORS[0] }} aria-hidden="true" />}
                  label={t('energyFlow.node.battery', 'Battery')}
                  sublabel={
                    flow?.energy_remaining != null
                      ? `${fmtNumber(flow.energy_remaining, 1)} ${t('energyFlow.units.kwh', 'kWh')}`
                      : undefined
                  }
                >
                  <RadialGauge
                    value={batterySOC}
                    max={100}
                    label={t('energyFlow.node.battery', 'Battery')}
                    unit="%"
                    color={CHART_COLORS[0]}
                    size={100}
                  />
                </FlowNode>

                <FlowConnector
                  label={t('energyFlow.node.driving', 'Driving')}
                  value={t('energyFlow.na', 'N/A')}
                  color={CHART_COLORS[0]}
                  active={false}
                />

                <FlowNode
                  dimmed
                  icon={<Car className="h-8 w-8" style={{ color: CHART_COLORS[0] }} aria-hidden="true" />}
                  label={t('energyFlow.node.motor', 'Motor')}
                  sublabel={t('energyFlow.node.noLiveData', 'No live data')}
                />
              </div>
            </SectionState>
          </GlassPanel>

          {/* Side: live power breakdown */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('energyFlow.livePower.title', 'Live Power')}
            </PanelTitle>

            <SectionState
              noVehicle={noVehicle}
              loading={flowLoading}
              error={flowError}
              empty={false}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.livePower.noData', 'No live power data available.')}
              onRetry={() => refetchFlow()}
              skeletonHeight={200}
            >
              <div className="space-y-2">
                <LivePowerRow
                  icon={<Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.dc', 'DC Power')}
                  value={`${fmtNumber(flow?.dc_charging_power ?? 0, 1)} ${t('energyFlow.units.kw', 'kW')}`}
                  valueClass="text-cyan-300"
                />
                <LivePowerRow
                  icon={<Activity className="h-4 w-4 text-indigo-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.ac', 'AC Power')}
                  value={`${fmtNumber(flow?.ac_charging_power ?? 0, 1)} ${t('energyFlow.units.kw', 'kW')}`}
                  valueClass="text-indigo-300"
                />
                <LivePowerRow
                  dimmed
                  icon={<Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.hvac', 'HVAC')}
                  value={t('energyFlow.na', 'N/A')}
                />
                <LivePowerRow
                  dimmed
                  icon={<Cpu className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.accessories', 'Accessories')}
                  value={t('energyFlow.na', 'N/A')}
                />
              </div>
            </SectionState>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 3 — Daily energy usage (hero chart) + efficiency metrics ── */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('energyFlow.usage.title', 'Daily Energy Usage')}
            </PanelTitle>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              error={statsError}
              empty={dailyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.usage.noData', 'No daily energy data available.')}
              onRetry={() => refetchStats()}
            >
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    <defs>
                      <ChartGradient id="gradEnergy" color={CHART_COLORS[0]} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="energy"
                      name={`${t('energyFlow.table.energy', 'Energy')} (${t('energyFlow.units.kwh', 'kWh')})`}
                      stroke={CHART_COLORS[0]}
                      fill="url(#gradEnergy)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SectionState>
          </GlassPanel>

          {/* Efficiency metrics side panel */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('energyFlow.metrics.title', 'Efficiency Metrics')}
            </PanelTitle>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              error={statsError}
              empty={!stats}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.metrics.noData', 'No efficiency metrics available.')}
              onRetry={() => refetchStats()}
              skeletonHeight={240}
            >
              <div className="space-y-3">
                <EfficiencyStat
                  label={efficiencyUnit}
                  value={fmtNumber(avgEfficiency, 0)}
                  valueClass="text-cyan-300"
                  badge={<Badge variant={effVariant} size="sm">{effLabel}</Badge>}
                />
                <EfficiencyStat
                  label={t('energyFlow.kpi.co2Saved', 'CO₂ Saved')}
                  value={fmtNumber(stats?.co2_saved_kg ?? 0, 1)}
                  valueClass="text-emerald-300"
                  badge={<Badge variant="success" size="sm">{t('energyFlow.units.kgCo2', 'kg CO₂')}</Badge>}
                />
                <EfficiencyStat
                  label={t('energyFlow.metrics.avgPerDay', 'Avg Energy/Day')}
                  value={formatEnergy(avgEnergyPerDay)}
                  valueClass="text-amber-300"
                  badge={<Badge variant="info" size="sm">{t('energyFlow.metrics.perDay', 'per day')}</Badge>}
                />
              </div>
            </SectionState>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 4 — Daily distance + daily efficiency charts ── */}
      <FadeIn delay={0.3}>
        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('energyFlow.distance.title', 'Daily Distance')}
            </PanelTitle>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              error={statsError}
              empty={dailyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.distance.noData', 'No daily distance data available.')}
              onRetry={() => refetchStats()}
            >
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar
                      dataKey="distance"
                      name={`${t('energyFlow.table.distance', 'Distance')} (${distanceUnit})`}
                      fill={CHART_COLORS[1]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionState>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('energyFlow.dailyEfficiency.title', 'Daily Efficiency')}
            </PanelTitle>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              error={statsError}
              empty={efficiencyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.dailyEfficiency.noData', 'No efficiency data available.')}
              onRetry={() => refetchStats()}
            >
              <div className="h-64 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={efficiencyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar
                      dataKey="efficiency"
                      name={efficiencyUnit}
                      fill={CHART_COLORS[3]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionState>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 5 — Daily energy history (full-width detail band) ── */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-300" aria-hidden="true" />
            {t('energyFlow.history.title', 'Daily Energy History')}
          </PanelTitle>
          <SectionState
            noVehicle={noVehicle}
            loading={statsLoading}
            error={statsError}
            empty={sortedDailyRows.length === 0}
            noVehicleMessage={noVehicleMsg}
            emptyMessage={t('energyFlow.history.noData', 'No energy history records available.')}
            onRetry={() => refetchStats()}
            skeletonHeight={280}
          >
            <DataTable
              tableId="battery:energy-flow-history"
              columns={historyColumns}
              data={sortedDailyRows}
              keyExtractor={(row) => row.date}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyMessage={t('energyFlow.history.empty', 'No energy records found.')}
              compact
              pagination
            />
          </SectionState>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
