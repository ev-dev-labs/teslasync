import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, Car, Plug, Thermometer, Cpu,
  ArrowRight, ArrowDown, Zap,
  Activity,
} from 'lucide-react';

import { PageLayout, CardGrid, LayoutCard } from '@/components/layout';
import {
  GlassPanel, Badge, DataTable, useSortToggle, type Column,
  Text, Caption, Label,
} from '@/components/ui';

import { StatStrip, StatGroup, type StatMetric } from '@/components/data-display';
import type { StatPeriod } from '@/lib/metric-reference';
import {
  LinearGauge, ChartTooltip, ChartGradient, EmbeddedChart,
  chartGrid, axisTick, chartMarginLabeled, chartAnimation, CHART_COLORS,
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { SectionState } from '../components/energy-flow-modernization/SectionState';

import { useRangeState } from '@/hooks/useRangeState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateShort } from '@/lib/dateFormat';

import { cn } from '@/lib/cn';
import { convertDistanceFromSI, convertEnergyFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { useEnergyStats, useEnergyFlow } from '@/api/hooks/useEnergy';
import type { DailyEnergy, EnergyFlowData } from '@/types/energy';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ───────── Constants ───────── */



/** Universal "value unknown" placeholder (shared across the app). */
const DASH = '—';

/* ───────── Pure display helpers (exported for unit tests) ───────── */

/** One point in the daily energy + distance charts. Every value is already in
 *  the user's DISPLAY units — energy in kWh, distance in km|mi — so the charts,
 *  the KPI band and the history table never disagree about what a number means. */
export interface DailyChartPoint {
  date: string;
  /** Daily energy in kWh (converted from the SI watt-hours the API returns). */
  energy: number | null;
  /** Daily distance in the user's display unit (converted from SI metres). */
  distance: number | null;
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
 * inputs remain unknown rather than becoming a measured zero.
 */
export function scaleEfficiency(
  whPerMeter: number | null | undefined,
  distanceUnit: DistanceUnitPref,
): number | null {
  if (whPerMeter == null || !Number.isFinite(whPerMeter)) return null;
  const perMeter = whPerMeter;
  const metersPerUnit = 1 / convertDistanceFromSI(1, distanceUnit);
  return Math.round(perMeter * metersPerUnit);
}

/**
 * Bucket an already-scaled average efficiency into a rating for badge display.
 * Non-positive / non-finite values (no data yet) map to `'none'`.
 */
export function efficiencyRating(
  avgEfficiency: number | null,
  distanceUnit: DistanceUnitPref,
): EfficiencyRating {
  if (avgEfficiency == null || !(avgEfficiency > 0)) return 'none';
  const excellent = distanceUnit === 'km' ? 150 : 240;
  const good = distanceUnit === 'km' ? 200 : 320;
  if (avgEfficiency < excellent) return 'excellent';
  if (avgEfficiency < good) return 'good';
  return 'high';
}

/** Total instantaneous charge power (kW) = DC + AC. Both operands must
 * be known; a missing channel cannot silently count as a measured zero. */
export function computeChargePower(flow: EnergyFlowData | null | undefined): number | null {
  if (flow?.dc_charging_power == null || flow.ac_charging_power == null) return null;
  return flow.dc_charging_power + flow.ac_charging_power;
}

/** Build the daily energy + distance chart series in the user's display units. */
export function buildDailyChartData(
  rows: readonly DailyEnergy[],
  distanceUnit: DistanceUnitPref,
): DailyChartPoint[] {
  return rows.map((d) => ({
    date: formatDateShort(d.date),
    energy: d.energy_wh != null ? convertEnergyFromSI(d.energy_wh, 'kWh') : null,
    distance: d.distance_m != null ? convertDistanceFromSI(d.distance_m, distanceUnit) : null,
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
      efficiency: scaleEfficiency(d.efficiency_wh_per_m, distanceUnit)!,
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
        <ArrowDown className="h-3.5 w-3.5 @[640px]:hidden" aria-hidden="true" />
        <ArrowRight className="hidden h-3.5 w-3.5 @[640px]:block" aria-hidden="true" />
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
        'flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2',
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

/* ───────── Main Page ───────── */

export default function EnergyFlowPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('energyFlow.title', 'Energy flow'));

  const { vehicleId } = useSelectedVehicle();
  const { formatDistance, formatEnergy, unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const { start, end } = useRangeState({
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
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = statsQuery;
  const statsState = useDataState(statsQuery, { provenance: 'historical' });

  // Real-time flow — GET /vehicles/{id}/energy/flow
  const flowQuery = useEnergyFlow(activeId);
  const { data: flow, isLoading: flowLoading, refetch: refetchFlow } = flowQuery;
  const flowState = useDataState(flowQuery, { provenance: 'live' });
  const dataSources = useMemo(
    () => [
      {
        id: 'vehicle-energy-summary',
        label: t('dataSources.labels.vehicleEnergySummary', 'Vehicle energy summary'),
        query: statsQuery,
        enabled: !noVehicle,
      },
      {
        id: 'vehicle-energy-flow',
        label: t('dataSources.labels.vehicleEnergyFlow', 'Vehicle energy flow'),
        query: flowQuery,
        enabled: !noVehicle,
      },
    ],
    [flowQuery, noVehicle, statsQuery, t],
  );

  /* ─── Derived: real-time flow ─── */
  const chargePower = computeChargePower(flow);
  const batterySOC = flow?.soc ?? null;
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
  const dailyEnergyTableData = useMemo(
    () => dailyChartData.map(({ date, energy }) => ({ date, energy })),
    [dailyChartData],
  );
  const dailyDistanceTableData = useMemo(
    () => dailyChartData.map(({ date, distance }) => ({ date, distance })),
    [dailyChartData],
  );
  const dailyEfficiencyTableData = useMemo(
    () => efficiencyChartData.map(({ date, efficiency }) => ({ date, efficiency })),
    [efficiencyChartData],
  );

  /* ─── Derived: stat values with unit conversion ─── */
  const avgEfficiency = useMemo(
    () => scaleEfficiency(stats?.avg_efficiency_wh_per_m, distanceUnit),
    [stats, distanceUnit],
  );

  const efficiencyUnit = distanceUnit === 'km' ? t('energyFlow.units.whPerKm', 'Wh/km') : t('energyFlow.units.whPerMi', 'Wh/mi');

  const avgEnergyPerDay = useMemo(() => {
    const period = stats?.period_days;
    return period != null && period > 0 && stats?.total_energy_used_wh != null
      ? stats.total_energy_used_wh / period : null;
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
          : t('energyFlow.efficiency.noData', 'No data');

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
        filterValue: (row) => row.date ?? null,
        filterValueLabel: (_, row) => formatDateShort(row.date),
        header: t('energyFlow.table.date', 'Date'),
        sortable: true,
        render: (row) => <Text variant="bodySm">{formatDateShort(row.date)}</Text>,
      },
      {
        key: 'energy_wh',
        align: 'right',
        filterValue: (row) => row.energy_wh ?? null,
        filterValueLabel: (value, row) => value == null ? '—' : formatEnergy(row.energy_wh ?? 0),
        header: t('energyFlow.table.energy', 'Energy'),
        sortable: true,
        render: (row) => (
          <Text size="sm" weight="semibold" mono color="primary">
            {row.energy_wh != null ? formatEnergy(row.energy_wh) : DASH}
          </Text>
        ),
      },
      {
        key: 'distance_m',
        align: 'right',
        filterValue: (row) => row.distance_m ?? null,
        filterValueLabel: (value, row) => value == null ? '—' : formatDistance(row.distance_m ?? 0),
        header: `${t('energyFlow.table.distance', 'Distance')} (${distanceUnit})`,
        sortable: true,
        render: (row) => (
          <Text size="sm" mono color="primary">{row.distance_m != null ? formatDistance(row.distance_m) : DASH}</Text>
        ),
      },
      {
        key: 'efficiency_wh_per_m',
        align: 'right',
        filterValue: (row) => row.efficiency_wh_per_m ?? null,
        filterValueLabel: (value, row) => value == null ? '—' : fmtNumber(scaleEfficiency(row.efficiency_wh_per_m, distanceUnit)),
        header: efficiencyUnit,
        sortable: true,
        render: (row) => (
          <Text size="sm" mono color="primary">
            {row.efficiency_wh_per_m != null ? fmtNumber(scaleEfficiency(row.efficiency_wh_per_m, distanceUnit)!) : DASH}
          </Text>
        ),
      },
    ],
    [t, distanceUnit, efficiencyUnit, formatDistance, formatEnergy, fmtNumber],
  );

  /* ───── Vehicle & Range Controls ───── */


  const noVehicleMsg = t('energyFlow.noVehicle', 'Select a vehicle to view its energy flow.');
  // The backend honors a trailing day count, not precise calendar bounds.
  // Do not present the workspace's custom dates as server-side coverage.
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('energyFlow.summary.trailingWindow', 'Trailing {{days}} days', { days }),
    reason: t('energyFlow.summary.windowReason', 'The energy endpoint uses a trailing day count; custom calendar bounds are not applied by this source.'),
  };
  const missingReason = t('energyFlow.state.missing', 'No measurement supplied');
  const summaryMetrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'total-used', rawValue: stats?.total_energy_used_wh,
      label: t('energyFlow.kpi.totalEnergy', 'Total energy'), missingReason },
    { metricId: 'energy', occurrenceId: 'total-charged', rawValue: stats?.total_energy_charged_wh,
      label: t('energyFlow.kpi.totalCharged', 'Total charged'), missingReason },
    { metricId: 'distance', rawValue: stats?.total_distance_m,
      label: t('energyFlow.kpi.distance', 'Distance'), missingReason },
    // Preserve the original whole-Wh rating/display calculation. Generic
    // efficiency defaults to kWh/distance, which is not this page's contract.
    { metricId: 'text', occurrenceId: 'average-efficiency',
      rawValue: avgEfficiency != null ? `${fmtNumber(avgEfficiency)} ${efficiencyUnit}` : null,
      label: t('energyFlow.kpi.efficiency', 'Efficiency'), missingReason },
    { metricId: 'text', occurrenceId: 'co2-saved',
      rawValue: stats?.co2_saved_kg != null ? `${fmtNumber(stats.co2_saved_kg)} ${t('energyFlow.units.kg', 'kg')}` : null,
      label: t('energyFlow.kpi.co2Saved', 'CO₂ saved'), missingReason,
      context: t('energyFlow.metrics.estimated', 'Estimated'),
      description: t('energyFlow.metrics.co2Estimate', 'Estimated avoided CO₂, not a vehicle emissions measurement.') },
    { metricId: 'text', occurrenceId: 'period-days',
      rawValue: stats?.period_days != null ? `${stats.period_days} ${t('energyFlow.units.days', 'days')}` : null,
      label: t('energyFlow.kpi.period', 'Period'), missingReason },
  ];
  const efficiencyMetrics: StatMetric[] = [
    { ...summaryMetrics[3], label: efficiencyUnit,
      context: <Badge variant={effVariant} size="sm">{effLabel}</Badge> },
    { ...summaryMetrics[4],
      context: <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" size="sm">{t('energyFlow.units.kgCo2', 'kg CO₂')}</Badge>
        <Caption>{t('energyFlow.metrics.estimated', 'Estimated')}</Caption>
      </div> },
    { metricId: 'energy', occurrenceId: 'average-per-day', rawValue: avgEnergyPerDay,
      label: t('energyFlow.metrics.avgPerDay', 'Avg energy/day'), missingReason,
      context: <Badge variant="info" size="sm">{t('energyFlow.metrics.perDay', 'per day')}</Badge> },
  ];

  /* ───── Main render ───── */

  return (
    <PageLayout
      title={t('energyFlow.title', 'Energy flow')}
      subtitle={t('energyFlow.subtitle', 'Power distribution and energy analysis')}
      query={[statsQuery, flowQuery]}
      dataSources={dataSources}
    >
      {/* ── 1 — KPI band: full-width responsive metric grid ── */}
      <FadeIn>
        <section aria-label={t('energyFlow.kpis', 'Energy summary metrics')}>
          <LayoutCard title={t('energyFlow.kpis', 'Energy summary metrics')}>
            {/* Keep all six metric labels/shells even before a source resolves.
                Recovery and trust notices are independent of those facts. */}
            <StatStrip metrics={summaryMetrics} period={period} variant="embedded"
              loading={!noVehicle && !statsState.hasData && statsLoading}
              retained={statsState.status === 'stale'} />
            <SectionState
              noVehicle={noVehicle} state={statsState} loading={false}
              empty={!stats && !statsLoading} noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.summary.noData', 'No energy summary available.')}
              onRetry={() => { void refetchStats(); }}
            >
              {null}
            </SectionState>
          </LayoutCard>
        </section>
      </FadeIn>

      {/* ── 2 — Live energy flow hero + live power breakdown ── */}
      <FadeIn delay={0.1}>
        <CardGrid label={t('energyFlow.diagram.title', 'Energy flow diagram')} items={[
          { id: 'live-flow', size: 'half', content: (
          /* Hero: real-time flow diagram (Grid → Battery → Motor) */
          <LayoutCard title={t('energyFlow.diagram.title', 'Energy flow diagram')}
            actions={chargeState ? (
                <Badge variant={chargeState === 'Charging' ? 'success' : 'neutral'} size="sm">
                  {t(chargeState, chargeState)}
                </Badge>
              ) : undefined}>

            <SectionState
              noVehicle={noVehicle}
              loading={flowLoading}
              state={flowState}
              empty={!flow}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.diagram.noData', 'No live flow data available.')}
              onRetry={() => { void refetchFlow(); }}
              skeletonHeight={200}
            >
              <div className="grid grid-cols-1 items-center gap-3 @[640px]:grid-cols-5">
                <FlowNode
                  icon={<Plug className="h-8 w-8" style={{ color: CHART_COLORS[1] }} aria-hidden="true" />}
                  label={t('energyFlow.node.grid', 'Grid')}
                />

                <FlowConnector
                  label={t('energyFlow.node.charging', 'Charging')}
                  value={chargePower != null ? `${fmtNumber(chargePower)} ${t('energyFlow.units.kw', 'kW')}` : DASH}
                  color={CHART_COLORS[1]}
                  active={chargePower != null && Math.abs(chargePower) > 0.01}
                />

                <FlowNode
                  icon={<Battery className="h-8 w-8" style={{ color: CHART_COLORS[0] }} aria-hidden="true" />}
                  label={t('energyFlow.node.battery', 'Battery')}
                  sublabel={
                    flow?.energy_remaining != null
                      ? `${fmtNumber(flow.energy_remaining)} ${t('energyFlow.units.kwh', 'kWh')}`
                      : undefined
                  }
                >
                  {batterySOC != null ? <LinearGauge
                    value={batterySOC}
                    max={100}
                    label={t('energyFlow.node.battery', 'Battery')}
                    unit="%"
                    color={CHART_COLORS[0]}
                    size={100}
                  /> : <Text mono>{DASH}</Text>}
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
          </LayoutCard>
          ) },
          { id: 'live-power', size: 'quarter', content: (

          /* Side: live power breakdown */
          <LayoutCard title={t('energyFlow.livePower.title', 'Live power')}>

            <SectionState
              noVehicle={noVehicle}
              loading={flowLoading}
              state={flowState}
              empty={!flow}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.livePower.noData', 'No live power data available.')}
              onRetry={() => { void refetchFlow(); }}
              skeletonHeight={200}
            >
              <div className="space-y-2">
                <LivePowerRow
                  icon={<Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.dc', 'DC power')}
                  value={flow?.dc_charging_power != null ? `${fmtNumber(flow.dc_charging_power)} ${t('energyFlow.units.kw', 'kW')}` : DASH}
                  valueClass="text-cyan-300"
                />
                <LivePowerRow
                  icon={<Activity className="h-4 w-4 text-indigo-300" aria-hidden="true" />}
                  label={t('energyFlow.livePower.ac', 'AC power')}
                  value={flow?.ac_charging_power != null ? `${fmtNumber(flow.ac_charging_power)} ${t('energyFlow.units.kw', 'kW')}` : DASH}
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
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── 3 — Daily energy usage (hero chart) + efficiency metrics ── */}
      <FadeIn delay={0.2}>
        <CardGrid label={t('energyFlow.usage.title', 'Daily energy usage')} items={[
          { id: 'daily-energy', size: 'half', content: (
          <LayoutCard title={t('energyFlow.usage.title', 'Daily energy usage')}>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              state={statsState}
              empty={dailyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.usage.noData', 'No daily energy data available.')}
              onRetry={() => { void refetchStats(); }}
            >
              <EmbeddedChart
                size="compact" fluid={false}
                exportable={false} fullscreen={false}
                title={t('energyFlow.usage.title', 'Daily energy usage')}
                ariaLabel={t('energyFlow.usage.aria', 'Daily energy usage over time')}
                data={dailyEnergyTableData}
                dataColumns={[
                  { key: 'date', label: t('energyFlow.table.date', 'Date') },
                  {
                    key: 'energy',
                    label: `${t('energyFlow.table.energy', 'Energy')} (${t('energyFlow.units.kwh', 'kWh')})`,
                    format: (value) => value != null ? fmtNumber(Number(value)) : DASH,
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="energy-flow-daily-energy-usage"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    <defs>
                      <ChartGradient id="gradEnergy" color={CHART_COLORS[0]} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="energy"
                      name={`${t('energyFlow.table.energy', 'Energy')} (${t('energyFlow.units.kwh', 'kWh')})`}
                      stroke={CHART_COLORS[0]}
                      fill="url(#gradEnergy)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            </SectionState>
          </LayoutCard>
          ) },
          { id: 'efficiency-metrics', size: 'quarter', content: (

          /* Efficiency metrics side panel */
          <LayoutCard title={t('energyFlow.metrics.title', 'Efficiency metrics')}>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              state={statsState}
              empty={!stats}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.metrics.noData', 'No efficiency metrics available.')}
              onRetry={() => { void refetchStats(); }}
              skeletonHeight={240}
            >
              <StatGroup metrics={efficiencyMetrics} period={period}
                retained={statsState.status === 'stale'} />
            </SectionState>
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── 4 — Daily distance + daily efficiency charts ── */}
      <FadeIn delay={0.3}>
        <CardGrid label={t('energyFlow.history.title', 'Daily energy history')} items={[
          { id: 'daily-distance', size: 'half', content: (
          <LayoutCard title={t('energyFlow.distance.title', 'Daily distance')}>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              state={statsState}
              empty={dailyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.distance.noData', 'No daily distance data available.')}
              onRetry={() => { void refetchStats(); }}
            >
              <EmbeddedChart
                size="compact" fluid={false}
                exportable={false} fullscreen={false}
                title={t('energyFlow.distance.title', 'Daily distance')}
                ariaLabel={t('energyFlow.distance.aria', 'Daily driving distance over time')}
                data={dailyDistanceTableData}
                dataColumns={[
                  { key: 'date', label: t('energyFlow.table.date', 'Date') },
                  {
                    key: 'distance',
                    label: `${t('energyFlow.table.distance', 'Distance')} (${distanceUnit})`,
                    format: (value) => value != null ? fmtNumber(Number(value)) : DASH,
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="energy-flow-daily-distance"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="distance"
                      name={`${t('energyFlow.table.distance', 'Distance')} (${distanceUnit})`}
                      fill={CHART_COLORS[1]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            </SectionState>
          </LayoutCard>
          ) },
          { id: 'daily-efficiency', size: 'half', content: (

          <LayoutCard title={t('energyFlow.dailyEfficiency.title', 'Daily efficiency')}>
            <SectionState
              noVehicle={noVehicle}
              loading={statsLoading}
              state={statsState}
              empty={efficiencyChartData.length === 0}
              noVehicleMessage={noVehicleMsg}
              emptyMessage={t('energyFlow.dailyEfficiency.noData', 'No efficiency data available.')}
              onRetry={() => { void refetchStats(); }}
            >
              <EmbeddedChart
                size="compact" fluid={false}
                exportable={false} fullscreen={false}
                title={t('energyFlow.dailyEfficiency.title', 'Daily efficiency')}
                ariaLabel={t('energyFlow.dailyEfficiency.aria', 'Daily driving efficiency over time')}
                data={dailyEfficiencyTableData}
                dataColumns={[
                  { key: 'date', label: t('energyFlow.table.date', 'Date') },
                  {
                    key: 'efficiency',
                    label: efficiencyUnit,
                    format: (value) => value != null ? fmtNumber(Number(value)) : DASH,
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="energy-flow-daily-efficiency"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={efficiencyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTick} />
                    <YAxis tick={axisTick} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="efficiency"
                      name={efficiencyUnit}
                      fill={CHART_COLORS[3]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            </SectionState>
          </LayoutCard>
          ) },
        ]} />
      </FadeIn>

      {/* ── 5 — Daily energy history (full-width detail band) ── */}
      <FadeIn delay={0.4}>
        <LayoutCard title={t('energyFlow.history.title', 'Daily energy history')}>
          <SectionState
            noVehicle={noVehicle}
            loading={statsLoading}
            state={statsState}
            empty={sortedDailyRows.length === 0}
            noVehicleMessage={noVehicleMsg}
            emptyMessage={t('energyFlow.history.noData', 'No energy history records available.')}
            onRetry={() => { void refetchStats(); }}
            skeletonHeight={280}
          >
            <DataTable
              enableValueFilters
              tableId="battery:energy-flow-history"
              caption={t('energyFlow.history.title', 'Daily energy history')}
              columns={historyColumns}
              mobileColumns={['date', 'energy_wh', 'efficiency_wh_per_m']}
              mobilePresentation={{
                variant: 'cards',
                roles: { date: 'title', energy_wh: 'primary', distance_m: 'meta', efficiency_wh_per_m: 'meta' },
                displayValue: (row, key) => {
                  if (key === 'date') return formatDateShort(row.date);
                  if (key === 'energy_wh') return row.energy_wh != null ? formatEnergy(row.energy_wh) : DASH;
                  if (key === 'distance_m') return row.distance_m != null ? formatDistance(row.distance_m) : DASH;
                  if (key === 'efficiency_wh_per_m') {
                    const value = scaleEfficiency(row.efficiency_wh_per_m, distanceUnit);
                    return value != null ? `${fmtNumber(value)} ${efficiencyUnit}` : DASH;
                  }
                  return DASH;
                },
              }}
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
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
