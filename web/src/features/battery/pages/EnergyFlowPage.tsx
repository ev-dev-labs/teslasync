import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Battery, Car, Plug, Thermometer, Cpu,
  ArrowRight, ArrowDown, Zap,
  TrendingUp, Activity, BarChart3,
  Leaf, Calendar, Gauge,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, useSortToggle, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, ChartGradient,
  chartGrid, axisTick, chartMarginLabeled, chartAnimation, CHART_COLORS,
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useEnergyFlow } from '@/api/hooks/useEnergy';

/* ───────── Types (match actual API response from energy_handler.go) ───────── */

interface DailyBreakdownEntry {
  date: string;
  energy_wh: number;
  distance_m: number;
  efficiency_wh_per_m: number;
  cost: number;
}

interface EnergyStatsResponse {
  vehicle_id: number;
  period_days: number;
  total_energy_used_wh: number;
  total_energy_charged_wh: number;
  total_wh: number;
  total_cost: number;
  total_distance_m: number;
  avg_efficiency_wh_per_m: number;
  co2_saved_kg: number;
  daily_breakdown: DailyBreakdownEntry[];
}

/* ───────── Constants ───────── */

const TIME_RANGES = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
] as const;

/* ───────── Flow Arrow ───────── */

function FlowArrow({
  direction,
  power,
  color,
  label,
}: {
  direction: 'right' | 'down';
  power: number;
  color: string;
  label: string;
}) {
  const { t } = useTranslation();
  const Icon = direction === 'right' ? ArrowRight : ArrowDown;
  const isActive = Math.abs(power) > 0.01;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <div
        className={cn(
          'flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-opacity',
          !isActive && 'opacity-30',
        )}
        style={{
          backgroundColor: `${color}18`,
          color,
          boxShadow: isActive ? `0 0 12px ${color}40` : 'none',
        }}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{fmtNumber(Math.abs(power), 1)} {t('kW')}</span>
      </div>
    </div>
  );
}

/* ───────── Main Page ───────── */

export default function EnergyFlowPage() {
  const { t } = useTranslation();
  usePageTitle(t('Energy Flow'));

  const { data: vehicles } = useVehicles();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [days, setDays] = useState('7');

  const activeId = vehicleId ?? (vehicles?.[0]?.id != null ? String(vehicles[0].id) : null);

  // Historical stats from GET /vehicles/{id}/energy
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['energy-stats', activeId, days],
    queryFn: () => request<EnergyStatsResponse>(`/vehicles/${activeId}/energy?days=${days}`),
    enabled: activeId != null,
    staleTime: 30_000,
  });

  // Real-time flow from GET /vehicles/{id}/energy/flow
  const { data: flow } = useEnergyFlow(activeId);

  const isLoading = statsLoading;

  /* ─── Derived: real-time flow ─── */
  const chargePower = (flow?.dc_charging_power ?? 0) + (flow?.ac_charging_power ?? 0);
  const batterySOC = flow?.soc ?? 0;
  const chargeState = flow?.charge_state ?? null;

  /* ─── Derived: daily chart data ─── */
  const dailyBreakdown = stats?.daily_breakdown ?? [];

  const dailyChartData = useMemo(
    () =>
      dailyBreakdown.map((d) => ({
        date: formatDateShort(d.date),
        energy_wh: d.energy_wh,
        distance: d.distance_m,
      })),
    [dailyBreakdown, distanceUnit],
  );

  const efficiencyChartData = useMemo(
    () =>
      dailyBreakdown
        .filter((d) => d.efficiency_wh_per_m > 0)
        .map((d) => ({
          date: formatDateShort(d.date),
          efficiency:
            distanceUnit === 'km'
              ? Number((d.efficiency_wh_per_m * 1000).toFixed(0))
              : d.efficiency_wh_per_m * 1609.344,
        })),
    [dailyBreakdown],
  );

  /* ─── Derived: stat values with unit conversion ─── */
  const totalDistance = formatDistance(stats?.total_distance_m ?? 0);

  const avgEfficiency = useMemo(() => {
    const raw = stats?.avg_efficiency_wh_per_m ?? 0;
    return distanceUnit === 'km'
      ? Number((raw * 1000).toFixed(0))
      : Math.round(raw * 1609.344);
  }, [stats, distanceUnit]);

  const efficiencyUnit = distanceUnit === 'km' ? 'Wh/km' : 'Wh/mi';

  const avgEnergyPerDay = useMemo(() => {
    const period = stats?.period_days ?? 0;
    return period > 0 ? (stats?.total_energy_used_wh ?? 0) / period : 0;
  }, [stats]);

  /* ─── Table ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('date', 'desc');

  const sortedDailyRows = useMemo(() => {
    const rows = dailyBreakdown.slice();
    return sortFn(rows, (row, key) => {
      if (key === 'energy_wh') return row.energy_wh;
      if (key === 'distance_m') return row.distance_m;
      if (key === 'efficiency_wh_per_m') return row.efficiency_wh_per_m;
      return row.date;
    });
  }, [dailyBreakdown, sortFn]);

  const historyColumns: Column<DailyBreakdownEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('Date'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">
            {formatDateShort(row.date)}
          </span>
        ),
      },
      {
        key: 'energy_wh',
        header: t('Energy'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
            {formatEnergy(row.energy_wh)}
          </span>
        ),
      },
      {
        key: 'distance_m',
        header: `${t('Distance')} (${distanceUnit})`,
        sortable: true,
        render: (row) => (
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {formatDistance(row.distance_m)}
          </span>
        ),
      },
      {
        key: 'efficiency_wh_per_m',
        header: efficiencyUnit,
        sortable: true,
        render: (row) => {
          const val =
            distanceUnit === 'km'
              ? row.efficiency_wh_per_m * 1000
              : row.efficiency_wh_per_m * 1609.344;
          return (
            <span className="font-mono text-sm text-[var(--text-primary)]">
              {fmtNumber(val, 0)}
            </span>
          );
        },
      },
    ],
    [t, distanceUnit, efficiencyUnit, formatDistance, formatEnergy],
  );

  /* ───── Vehicle & Range Controls ───── */

  const vehicleSelect =
    vehicles && vehicles.length > 1 ? (
      <Select
        options={(vehicles ?? []).map((v) => ({
          value: String(v.id),
          label: v.display_name || v.vin,
        }))}
        value={String(activeId ?? '')}
        onChange={(e) => setVehicleId(e.target.value)}
      />
    ) : undefined;

  const rangeButtons = (
    <div className="flex items-center gap-1">
      {TIME_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={days === r.value ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setDays(r.value)}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );

  const actions = (
    <div className="flex items-center gap-3">
      {vehicleSelect}
      {rangeButtons}
    </div>
  );

  /* ───── Loading skeleton ───── */

  if (isLoading) {
    return (
      <PageContainer title={t('Energy Flow')} subtitle={t('Power distribution and energy analysis')} actions={actions}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={120} rounded />
          ))}
        </div>
      </PageContainer>
    );
  }

  /* ───── Empty / Error ───── */

  if (!stats && !isLoading) {
    return (
      <PageContainer
        title={t('Energy Flow')}
        subtitle={t('Power distribution and energy analysis')}
        error={statsError as Error | null}
        actions={actions}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-10 w-10" />}
          title={t('No Data')}
          message={t('No energy flow data available for this vehicle and time range.')}
        />
      </PageContainer>
    );
  }

  /* ─── Efficiency thresholds (unit-aware) ─── */
  const excellentThreshold = distanceUnit === 'km' ? 150 : 240;
  const goodThreshold = distanceUnit === 'km' ? 200 : 320;

  /* ───── Main render ───── */

  return (
    <PageContainer title={t('Energy Flow')} subtitle={t('Power distribution and energy analysis')} actions={actions}>
      {/* ── Section 1: Energy Flow Diagram (real-time via /energy/flow) ── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5" style={{ color: CHART_COLORS[0] }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Energy Flow Diagram')}
              </span>
            </div>
            {chargeState && (
              <Badge variant={chargeState === 'Charging' ? 'success' : 'neutral'} size="sm">
                {t(chargeState)}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-5 items-center gap-4">
            {/* Grid → Battery */}
            <GlassPanel glow="green" className="flex flex-col items-center gap-2 p-4">
              <Plug className="h-8 w-8" style={{ color: CHART_COLORS[1] }} />
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t('Grid')}
              </span>
            </GlassPanel>

            <FlowArrow direction="right" power={chargePower} color={CHART_COLORS[1]} label={t('Charging')} />

            {/* Battery center — SOC from real-time flow */}
            <GlassPanel glow="cyan" className="flex flex-col items-center gap-3 p-5">
              <Battery className="h-8 w-8" style={{ color: CHART_COLORS[0] }} />
              <RadialGauge value={batterySOC} max={100} label={t('Battery')} unit="%" color={CHART_COLORS[0]} size={100} />
              {flow?.energy_remaining != null && (
                <span className="text-xs text-[var(--text-muted)]">
                  {fmtNumber(flow.energy_remaining, 1)} {t('kWh')}
                </span>
              )}
            </GlassPanel>

            {/* Motor — no real-time data available */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {t('Driving')}
              </span>
              <div
                className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold opacity-30"
                style={{ backgroundColor: `${CHART_COLORS[0]}18`, color: CHART_COLORS[0] }}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>{t('N/A')}</span>
              </div>
            </div>

            <GlassPanel className="flex flex-col items-center gap-2 p-4 opacity-50">
              <Car className="h-8 w-8" style={{ color: CHART_COLORS[0] }} />
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t('Motor')}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">{t('No live data')}</span>
            </GlassPanel>
          </div>

          {/* Bottom row: live charging breakdown + greyed-out aux */}
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:mx-auto lg:max-w-2xl">
            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <Zap className="h-5 w-5" style={{ color: CHART_COLORS[1] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('DC Power')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[1] }}>
                {fmtNumber(flow?.dc_charging_power ?? 0, 1)} {t('kW')}
              </span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <Activity className="h-5 w-5" style={{ color: CHART_COLORS[5] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('AC Power')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[5] }}>
                {fmtNumber(flow?.ac_charging_power ?? 0, 1)} {t('kW')}
              </span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3 opacity-50">
              <Thermometer className="h-5 w-5" style={{ color: CHART_COLORS[3] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('HVAC')}</span>
              <span className="text-xs text-[var(--text-muted)]">{t('N/A')}</span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3 opacity-50">
              <Cpu className="h-5 w-5" style={{ color: CHART_COLORS[2] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('Accessories')}</span>
              <span className="text-xs text-[var(--text-muted)]">{t('N/A')}</span>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 2: Summary MetricCards (historical from /energy) ── */}
      <FadeIn delay={0.1}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label={t('Total Energy')}
            value={formatEnergy(stats?.total_energy_used_wh ?? 0)}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('Total Charged')}
            value={formatEnergy(stats?.total_energy_charged_wh ?? 0)}
            icon={<Plug className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('Distance')}
            value={totalDistance}
            icon={<Car className="h-4 w-4" />}
            color="purple"
            subtitle={distanceUnit}
          />
          <MetricCard
            label={t('Efficiency')}
            value={avgEfficiency}
            icon={<Gauge className="h-4 w-4" />}
            color="amber"
            subtitle={efficiencyUnit}
          />
          <MetricCard
            label={t('CO₂ Saved')}
            value={fmtNumber(stats?.co2_saved_kg ?? 0, 1)}
            icon={<Leaf className="h-4 w-4" />}
            color="green"
            subtitle={t('kg')}
          />
          <MetricCard
            label={t('Period')}
            value={String(stats?.period_days ?? 0)}
            icon={<Calendar className="h-4 w-4" />}
            color="blue"
            subtitle={t('days')}
          />
        </div>
      </FadeIn>

      {/* ── Section 3: Daily Energy Usage AreaChart ── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" style={{ color: CHART_COLORS[0] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Daily Energy Usage')}
            </span>
          </div>

          {dailyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
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
                  dataKey="energy_wh"
                  name={t('Energy')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#gradEnergy)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No daily energy data available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Section 4: Daily Distance + Efficiency Charts ── */}
      <FadeIn delay={0.3}>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Daily Distance BarChart */}
          <GlassPanel className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" style={{ color: CHART_COLORS[1] }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Daily Distance')}
              </span>
            </div>

            {dailyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dailyChartData} margin={chartMarginLabeled} {...chartAnimation}>
                  {chartGrid}
                  <XAxis dataKey="date" tick={axisTick} />
                  <YAxis tick={axisTick} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="distance"
                    name={`${t('Distance')} (${distanceUnit})`}
                    fill={CHART_COLORS[1]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No daily distance data available.')} />
            )}
          </GlassPanel>

          {/* Efficiency Over Time */}
          <GlassPanel className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: CHART_COLORS[3] }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Daily Efficiency')}
              </span>
            </div>

            {efficiencyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
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
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No efficiency data available.')} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Section 5: Efficiency Metrics ── */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" style={{ color: CHART_COLORS[1] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Efficiency Metrics')}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs text-[var(--text-muted)]">{efficiencyUnit}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[0] }}>
                {fmtNumber(avgEfficiency, 0)}
              </span>
              <Badge variant={
                avgEfficiency === 0 ? 'neutral' :
                avgEfficiency < excellentThreshold ? 'success' :
                avgEfficiency < goodThreshold ? 'warning' : 'danger'
              } size="sm">
                {avgEfficiency === 0 ? t('No Data') :
                 avgEfficiency < excellentThreshold ? t('Excellent') :
                 avgEfficiency < goodThreshold ? t('Good') : t('High')}
              </Badge>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs text-[var(--text-muted)]">{t('CO₂ Saved')}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[1] }}>
                {fmtNumber(stats?.co2_saved_kg ?? 0, 1)}
              </span>
              <Badge variant="success" size="sm">
                {t('kg CO₂')}
              </Badge>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs text-[var(--text-muted)]">{t('Avg Energy/Day')}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[3] }}>
                {formatEnergy(avgEnergyPerDay)}
              </span>
              <Badge variant="info" size="sm">
                {t('per day')}
              </Badge>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 6: Daily Energy History Table ── */}
      <FadeIn delay={0.5}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" style={{ color: CHART_COLORS[4] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Daily Energy History')}
            </span>
          </div>

          {sortedDailyRows.length > 0 ? (
            <DataTable
              tableId="battery:energy-flow-history"
              columns={historyColumns}
              data={sortedDailyRows}
              keyExtractor={(row) => row.date}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyMessage={t('No energy records found.')}
              compact
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No energy history records available.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
