import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Battery, Car, Plug, Thermometer, Cpu,
  ArrowRight, ArrowLeft, ArrowDown, Zap,
  TrendingUp, Activity, BarChart3,
  PieChart as PieChartIcon,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, useSortToggle, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, ChartGradient,
  chartGrid, axisTick, chartMarginLabeled, chartAnimation, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';

/* ───────── Types ───────── */

type SnapshotType = 'driving' | 'charging' | 'regen' | 'hvac' | 'idle';

interface EnergySnapshot {
  id: number;
  vehicle_id: number;
  power_kw: number;
  energy_kwh: number;
  battery_level: number;
  type: SnapshotType;
  created_at: string;
}

interface DailyEnergy {
  date: string;
  consumed: number;
  charged: number;
  regen: number;
}

interface BreakdownEntry {
  type: string;
  energy: number;
}

interface EnergyStats {
  total_consumed: number;
  total_charged: number;
  net_energy: number;
  avg_power: number;
  peak_power: number;
  regen_energy: number;
  efficiency_wh_km: number;
  regen_ratio: number;
  hvac_pct: number;
  snapshots: EnergySnapshot[];
  daily: DailyEnergy[];
  breakdown: BreakdownEntry[];
}

/* ───────── Constants ───────── */

const TIME_RANGES = [
  { value: '1', label: '24h' },
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
] as const;

const TYPE_BADGE_VARIANT: Record<SnapshotType, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  driving: 'info',
  charging: 'success',
  regen: 'warning',
  hvac: 'danger',
  idle: 'neutral',
};

const BREAKDOWN_COLORS: Record<string, string> = {
  driving: CHART_COLORS[0],
  hvac: CHART_COLORS[3],
  accessories: CHART_COLORS[2],
  regen: CHART_COLORS[1],
  charging: CHART_COLORS[4],
  idle: CHART_COLORS[7],
};

/* ───────── Flow Arrow ───────── */

function FlowArrow({
  direction,
  power,
  color,
  label,
}: {
  direction: 'right' | 'left' | 'down';
  power: number;
  color: string;
  label: string;
}) {
  const { t } = useTranslation();
  const Icon = direction === 'right' ? ArrowRight : direction === 'left' ? ArrowLeft : ArrowDown;
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
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [days, setDays] = useState('7');

  const activeId = vehicleId ?? (vehicles?.[0]?.id != null ? String(vehicles[0].id) : null);

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['energy-flow', activeId, days],
    queryFn: () => request<EnergyStats>(`/analytics/energy?vehicle_id=${activeId}&days=${days}`),
    enabled: activeId != null,
    staleTime: 30_000,
  });

  /* Derived data */
  const latestSnapshot = stats?.snapshots?.[0];
  const batteryLevel = latestSnapshot?.battery_level ?? 0;

  const motorPower = useMemo(
    () =>
      (stats?.snapshots ?? [])
        .filter((s) => s.type === 'driving')
        .reduce((sum, s) => sum + Math.abs(s.power_kw), 0) /
        Math.max((stats?.snapshots ?? []).filter((s) => s.type === 'driving').length, 1),
    [stats],
  );

  const chargePower = useMemo(
    () =>
      (stats?.snapshots ?? [])
        .filter((s) => s.type === 'charging')
        .reduce((sum, s) => sum + Math.abs(s.power_kw), 0) /
        Math.max((stats?.snapshots ?? []).filter((s) => s.type === 'charging').length, 1),
    [stats],
  );

  const hvacPower = useMemo(
    () =>
      (stats?.snapshots ?? [])
        .filter((s) => s.type === 'hvac')
        .reduce((sum, s) => sum + Math.abs(s.power_kw), 0) /
        Math.max((stats?.snapshots ?? []).filter((s) => s.type === 'hvac').length, 1),
    [stats],
  );

  const accessoryPower = useMemo(
    () =>
      (stats?.snapshots ?? [])
        .filter((s) => s.type === 'idle')
        .reduce((sum, s) => sum + Math.abs(s.power_kw), 0) /
        Math.max((stats?.snapshots ?? []).filter((s) => s.type === 'idle').length, 1),
    [stats],
  );

  const powerTimeline = useMemo(
    () =>
      (stats?.snapshots ?? [])
        .slice()
        .reverse()
        .map((s) => ({
          time: formatDateShort(s.created_at),
          consumption: s.type !== 'regen' && s.type !== 'charging' ? s.power_kw : 0,
          regen: s.type === 'regen' ? -Math.abs(s.power_kw) : 0,
        })),
    [stats],
  );

  const pieData = useMemo(
    () =>
      (stats?.breakdown ?? []).map((b) => ({
        name: b.type,
        value: Math.abs(b.energy),
        fill: BREAKDOWN_COLORS[b.type] ?? CHART_COLORS[5],
      })),
    [stats],
  );

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('created_at', 'desc');

  const sortedSnapshots = useMemo(() => {
    const rows = (stats?.snapshots ?? []).slice(0, 50);
    return sortFn(rows, (row, key) => {
      if (key === 'power_kw') return row.power_kw;
      if (key === 'energy_kwh') return row.energy_kwh;
      if (key === 'type') return row.type;
      return new Date(row.created_at).getTime();
    });
  }, [stats, sortFn]);

  const historyColumns: Column<EnergySnapshot>[] = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        key: 'power_kw',
        header: t('Power (kW)'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
            {fmtNumber(row.power_kw, 2)}
          </span>
        ),
      },
      {
        key: 'energy_kwh',
        header: t('Energy (kWh)'),
        sortable: true,
        render: (row) => (
          <span className="font-mono text-sm text-[var(--text-primary)]">
            {fmtNumber(row.energy_kwh, 2)}
          </span>
        ),
      },
      {
        key: 'type',
        header: t('Type'),
        sortable: true,
        render: (row) => (
          <Badge variant={TYPE_BADGE_VARIANT[row.type]} size="sm">
            {t(row.type)}
          </Badge>
        ),
      },
    ],
    [t],
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
        error={error as Error | null}
        actions={actions}
      >
        <EmptyState
          icon={<Zap className="h-10 w-10" />}
          title={t('No Data')}
          message={t('No energy flow data available for this vehicle and time range.')}
        />
      </PageContainer>
    );
  }

  /* ───── Main render ───── */

  return (
    <PageContainer title={t('Energy Flow')} subtitle={t('Power distribution and energy analysis')} actions={actions}>
      {/* ── Section 1: Energy Flow Diagram ── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5" style={{ color: CHART_COLORS[0] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Energy Flow Diagram')}
            </span>
          </div>

          <div className="grid grid-cols-5 items-center gap-4">
            {/* Grid charging → Battery */}
            <GlassPanel glow="green" className="flex flex-col items-center gap-2 p-4">
              <Plug className="h-8 w-8" style={{ color: CHART_COLORS[1] }} />
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t('Grid')}
              </span>
            </GlassPanel>

            <FlowArrow direction="right" power={chargePower} color={CHART_COLORS[1]} label={t('Charging')} />

            {/* Battery center */}
            <GlassPanel glow="cyan" className="flex flex-col items-center gap-3 p-5">
              <Battery className="h-8 w-8" style={{ color: CHART_COLORS[0] }} />
              <RadialGauge value={batteryLevel} max={100} label={t('Battery')} unit="%" color={CHART_COLORS[0]} size={100} />
            </GlassPanel>

            <FlowArrow direction="right" power={motorPower} color={CHART_COLORS[0]} label={t('Driving')} />

            {/* Motor / Drive */}
            <GlassPanel glow="cyan" className="flex flex-col items-center gap-2 p-4">
              <Car className="h-8 w-8" style={{ color: CHART_COLORS[0] }} />
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t('Motor')}
              </span>
            </GlassPanel>
          </div>

          {/* Bottom row: HVAC + Accessories */}
          <div className="mt-4 grid grid-cols-5 items-start gap-4">
            <div /> {/* spacer */}
            <div /> {/* spacer */}
            <div className="flex justify-center">
              <FlowArrow direction="down" power={hvacPower + accessoryPower} color={CHART_COLORS[3]} label={t('Aux')} />
            </div>
            <div /> {/* spacer */}
            <div /> {/* spacer */}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:mx-auto lg:max-w-2xl">
            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <Thermometer className="h-5 w-5" style={{ color: CHART_COLORS[3] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('HVAC')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[3] }}>
                {fmtNumber(hvacPower, 1)} {t('kW')}
              </span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <Cpu className="h-5 w-5" style={{ color: CHART_COLORS[2] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('Accessories')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[2] }}>
                {fmtNumber(accessoryPower, 1)} {t('kW')}
              </span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <TrendingUp className="h-5 w-5" style={{ color: CHART_COLORS[1] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('Regen')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[1] }}>
                {fmtNumber(stats?.regen_energy ?? 0, 1)} {t('kWh')}
              </span>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-1 p-3">
              <Activity className="h-5 w-5" style={{ color: CHART_COLORS[5] }} />
              <span className="text-[11px] text-[var(--text-muted)]">{t('Peak')}</span>
              <span className="text-xs font-semibold" style={{ color: CHART_COLORS[5] }}>
                {fmtNumber(stats?.peak_power ?? 0, 1)} {t('kW')}
              </span>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 2: Summary MetricCards ── */}
      <FadeIn delay={0.1}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label={t('Total Consumed')}
            value={fmtNumber(stats?.total_consumed ?? 0, 1)}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
            subtitle={t('kWh')}
          />
          <MetricCard
            label={t('Total Charged')}
            value={fmtNumber(stats?.total_charged ?? 0, 1)}
            icon={<Plug className="h-4 w-4" />}
            color="green"
            subtitle={t('kWh')}
          />
          <MetricCard
            label={t('Net Energy')}
            value={fmtNumber(stats?.net_energy ?? 0, 1)}
            icon={<Activity className="h-4 w-4" />}
            color="purple"
            subtitle={t('kWh')}
          />
          <MetricCard
            label={t('Avg Power')}
            value={fmtNumber(stats?.avg_power ?? 0, 1)}
            icon={<TrendingUp className="h-4 w-4" />}
            color="amber"
            subtitle={t('kW')}
          />
          <MetricCard
            label={t('Peak Power')}
            value={fmtNumber(stats?.peak_power ?? 0, 1)}
            icon={<Zap className="h-4 w-4" />}
            color="red"
            subtitle={t('kW')}
          />
          <MetricCard
            label={t('Regen Energy')}
            value={fmtNumber(stats?.regen_energy ?? 0, 1)}
            icon={<TrendingUp className="h-4 w-4" />}
            color="green"
            subtitle={t('kWh')}
          />
        </div>
      </FadeIn>

      {/* ── Section 3: Power Over Time AreaChart ── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" style={{ color: CHART_COLORS[0] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Power Over Time')}
            </span>
          </div>

          {powerTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={powerTimeline} margin={chartMarginLabeled} {...chartAnimation}>
                <defs>
                  <ChartGradient id="gradConsumption" color={CHART_COLORS[0]} />
                  <ChartGradient id="gradRegen" color={CHART_COLORS[1]} />
                </defs>
                {chartGrid}
                <XAxis dataKey="time" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="consumption"
                  name={t('Consumption')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#gradConsumption)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="regen"
                  name={t('Regen')}
                  stroke={CHART_COLORS[1]}
                  fill="url(#gradRegen)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('No power timeline data available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Section 4: Breakdown Pie + Daily BarChart ── */}
      <FadeIn delay={0.3}>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Energy Breakdown PieChart */}
          <GlassPanel className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" style={{ color: CHART_COLORS[2] }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Energy Breakdown')}
              </span>
            </div>

            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={50}
                    paddingAngle={3}
                    {...chartAnimation}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.fill} stroke="transparent" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={t('No breakdown data available.')} />
            )}
          </GlassPanel>

          {/* Daily Energy BarChart */}
          <GlassPanel className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" style={{ color: CHART_COLORS[3] }} />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Daily Energy')}
              </span>
            </div>

            {(stats?.daily ?? []).length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats?.daily ?? []} margin={chartMarginLabeled} {...chartAnimation}>
                  {chartGrid}
                  <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => formatDateShort(v)} />
                  <YAxis tick={axisTick} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="consumed" name={t('Consumed')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="charged" name={t('Charged')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="regen" name={t('Regen')} fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={t('No daily energy data available.')} />
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
              <span className="text-xs text-[var(--text-muted)]">{t('Wh/km')}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[0] }}>
                {fmtNumber(stats?.efficiency_wh_km ?? 0, 1)}
              </span>
              <Badge variant={
                (stats?.efficiency_wh_km ?? 999) < 150 ? 'success' :
                (stats?.efficiency_wh_km ?? 999) < 200 ? 'warning' : 'danger'
              } size="sm">
                {(stats?.efficiency_wh_km ?? 999) < 150 ? t('Excellent') :
                 (stats?.efficiency_wh_km ?? 999) < 200 ? t('Good') : t('High')}
              </Badge>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs text-[var(--text-muted)]">{t('Regen Ratio')}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[1] }}>
                {fmtPercent(stats?.regen_ratio ?? 0, 1)}
              </span>
              <Badge variant={
                (stats?.regen_ratio ?? 0) > 0.2 ? 'success' :
                (stats?.regen_ratio ?? 0) > 0.1 ? 'warning' : 'danger'
              } size="sm">
                {(stats?.regen_ratio ?? 0) > 0.2 ? t('Strong') :
                 (stats?.regen_ratio ?? 0) > 0.1 ? t('Moderate') : t('Low')}
              </Badge>
            </GlassPanel>

            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs text-[var(--text-muted)]">{t('HVAC % of Total')}</span>
              <span className="text-2xl font-bold" style={{ color: CHART_COLORS[3] }}>
                {fmtPercent(stats?.hvac_pct ?? 0, 1)}
              </span>
              <Badge variant={
                (stats?.hvac_pct ?? 1) < 0.15 ? 'success' :
                (stats?.hvac_pct ?? 1) < 0.3 ? 'warning' : 'danger'
              } size="sm">
                {(stats?.hvac_pct ?? 1) < 0.15 ? t('Efficient') :
                 (stats?.hvac_pct ?? 1) < 0.3 ? t('Moderate') : t('High')}
              </Badge>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 6: Energy History Table ── */}
      <FadeIn delay={0.5}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" style={{ color: CHART_COLORS[4] }} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t('Energy History')}
            </span>
          </div>

          {sortedSnapshots.length > 0 ? (
            <DataTable
              columns={historyColumns}
              data={sortedSnapshots}
              keyExtractor={(row) => row.id}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyMessage={t('No energy records found.')}
              compact
              pagination
            />
          ) : (
            <EmptyState message={t('No energy history records available.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
