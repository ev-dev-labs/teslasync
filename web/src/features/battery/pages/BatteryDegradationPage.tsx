import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, Calendar, AlertTriangle,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip,
  chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ── Types ─────────────────────────────────────────────── */

interface DegradationEntry {
  date: string;
  odometer: number;
  soh_pct: number;
  capacity_kwh: number;
  range_km: number;
}

/* ── Helpers ───────────────────────────────────────────── */

function sohColor(soh: number): string {
  if (soh > 90) return CHART_COLORS[1];
  if (soh >= 80) return CHART_COLORS[3];
  return '#ef4444';
}

function scoreVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

function riskLevel(count: number, low: number, high: number): 'success' | 'warning' | 'danger' {
  if (count <= low) return 'success';
  if (count <= high) return 'warning';
  return 'danger';
}

function ageLabel(
  months: number,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (months < 12) return t('{{count}} months', { count: months });
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? t('{{y}}y {{m}}m', { y: years, m: rem })
    : t('{{y}} years', { y: years });
}

/* ── Page ──────────────────────────────────────────────── */

export default function BatteryDegradationPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.degradation.title', 'Battery Degradation'));

  /* Vehicle selector */
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;
  const activeIdStr = activeId != null ? String(activeId) : null;

  /* Battery health analytics (for overview stats, history table) */
  const { data, isLoading, error } = useBatteryHealthAnalytics(activeIdStr);

  /* Degradation data (for prediction, risk factors, trend) */
  const { data: degradation } = useBatteryDegradation(activeIdStr);

  /* Chart data */
  const rangeData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];
    const originalRange = data.history[0].range_km;
    return data.history.map((h) => ({
      date: formatDate(h.date),
      original: originalRange,
      current: h.range_km,
    }));
  }, [data]);

  /* Projection chart: actual history + predicted future */
  const projectionChartData = useMemo(() => {
    const hist = (data?.history ?? []).map((h) => ({
      label: formatDate(h.date),
      health: h.soh_pct,
      projected: undefined as number | undefined,
    }));
    const proj = (degradation?.prediction?.projection_points ?? []).map((p) => ({
      label: p.month,
      health: undefined as number | undefined,
      projected: p.health,
    }));
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = { ...proj[0], health: hist[hist.length - 1].health };
    }
    return [...hist, ...proj];
  }, [data, degradation]);

  /* Risk factors from degradation data */
  const habits = degradation?.charging_habits;
  const totalCharges = (habits?.fast_charge_count ?? 0) + (habits?.slow_charge_count ?? 0);
  const fastChargePct = totalCharges > 0
    ? Math.round(((habits?.fast_charge_count ?? 0) / totalCharges) * 100)
    : 0;

  const cycleDepthScore = data
    ? Math.max(0, Math.round(100 - data.avg_depth_of_discharge))
    : 0;

  /* Table columns */
  const columns: Column<DegradationEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('Date'),
        render: (row: DegradationEntry) => formatDate(row.date),
        sortable: true,
      },
      {
        key: 'odometer',
        header: t('Odometer'),
        render: (row: DegradationEntry) => `${fmtNumber(row.odometer)} km`,
        sortable: true,
      },
      {
        key: 'soh_pct',
        header: t('SOH %'),
        render: (row: DegradationEntry) => (
          <Badge
            variant={
              row.soh_pct > 90
                ? 'success'
                : row.soh_pct >= 80
                  ? 'warning'
                  : 'danger'
            }
          >
            {fmtNumber(row.soh_pct)}%
          </Badge>
        ),
        sortable: true,
      },
      {
        key: 'capacity_kwh',
        header: t('Capacity'),
        render: (row: DegradationEntry) =>
          `${fmtNumber(row.capacity_kwh)} kWh`,
        sortable: true,
      },
      {
        key: 'range_km',
        header: t('Range'),
        render: (row: DegradationEntry) => `${fmtNumber(row.range_km)} km`,
        sortable: true,
      },
    ],
    [t],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Battery Degradation')}
      subtitle={t('Health trends, degradation predictions, and charging habit impact')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(Number(e.target.value))}
          />
        ) : undefined
      }
    >
      {/* ── Summary Metrics ───────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label={t('Current SOH')}
            value={`${fmtNumber(data?.current_soh ?? 0)}%`}
            icon={<Battery className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('Estimated Capacity')}
            value={`${fmtNumber(data?.estimated_capacity ?? 0)} kWh`}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('Degradation Rate')}
            value={`${fmtNumber(data?.degradation_rate_yr ?? 0)}%/yr`}
            icon={<TrendingDown className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('Battery Age')}
            value={data ? ageLabel(data.battery_age_months, t) : '—'}
            icon={<Calendar className="h-4 w-4" />}
          />
        </div>
      </FadeIn>

      {/* ── Health Gauge + Cycle Stats ────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FadeIn delay={0.05}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            <RadialGauge
              value={data?.current_soh ?? 0}
              max={100}
              label={t('Battery Health')}
              unit="%"
              color={sohColor(data?.current_soh ?? 0)}
              size={180}
            />
            <div className="mt-3 flex items-center gap-2">
              <Badge
                variant={
                  (data?.current_soh ?? 0) > 90
                    ? 'success'
                    : (data?.current_soh ?? 0) >= 80
                      ? 'warning'
                      : 'danger'
                }
              >
                {(data?.current_soh ?? 0) > 90
                  ? t('Excellent')
                  : (data?.current_soh ?? 0) >= 80
                    ? t('Good')
                    : t('Degraded')}
              </Badge>
            </div>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.1}>
          <GlassPanel className="p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <TrendingDown className="h-4 w-4 text-neon-purple" />
              {t('battery.degradation.prediction', 'Prediction')}
            </div>
            {degradation?.prediction?.has_enough_data ? (
              <div className="space-y-4">
                <div className="rounded-xl p-4 bg-neon-purple/[0.08] border border-neon-purple/15">
                  <p className="text-sm text-white/70">
                    {t('battery.degradation.predictionDesc', 'At current rate, battery reaches')}{' '}
                    <span className="font-bold text-neon-amber">80%</span>{' '}
                    {t('battery.degradation.inApprox', 'in approximately')}{' '}
                    <span className="font-bold text-neon-purple">
                      ~{fmtNumber(degradation.prediction.years_to_80_pct ?? 0)} {t('battery.degradation.years', 'years')}
                    </span>
                    {degradation.prediction.predicted_date && (
                      <> ({degradation.prediction.predicted_date})</>
                    )}
                  </p>
                </div>
                <Grid cols={{ default: 2 }} gap={3}>
                  <MetricCard
                    label={t('battery.degradation.rate', 'Degradation Rate')}
                    value={`${fmtNumber(Math.abs(degradation.prediction.slope_per_year))}%/yr`}
                    color="red"
                  />
                  <MetricCard
                    label={t('battery.degradation.stress', 'Stress Level')}
                    value={degradation.stress_level ?? '—'}
                    color={
                      degradation.stress_level === 'Low' ? 'green' :
                      degradation.stress_level === 'Medium' ? 'amber' : 'red'
                    }
                  />
                </Grid>
                <div className="grid grid-cols-2 gap-4">
                  <MetricCard
                    label={t('battery.degradation.totalCycles', 'Total Cycles')}
                    value={fmtNumber(data?.total_cycles ?? degradation.current_cycles ?? 0)}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('battery.degradation.avgDoD', 'Avg Depth of Discharge')}
                    value={`${fmtNumber(data?.avg_depth_of_discharge ?? 0)}%`}
                    color="purple"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-4 bg-white/[0.02] text-center">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-neon-amber/50" />
                <p className="text-sm text-white/50">
                  {t('battery.degradation.needMore', 'Need more data points to generate prediction (minimum 3 snapshots required)')}
                </p>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* ── Health Trend & Projection ─────────────────── */}
      {projectionChartData.length > 0 ? (
        <FadeIn delay={0.15}>
          <GlassPanel className="p-6">
            <div className="mb-4 text-sm font-semibold">
              {t('battery.degradation.trendTitle', 'Health Trend & Projection')}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={projectionChartData}>
                {chartGrid}
                <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis domain={[60, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="6 4" />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="6 4" />
                <Line
                  type="monotone"
                  dataKey="health"
                  name={t('battery.degradation.actualHealth', 'Actual Health %')}
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ fill: '#10b981', r: 3 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="projected"
                  name={t('battery.degradation.projected', 'Projected %')}
                  stroke="#a855f7"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      ) : (
        <Skeleton height={280} />
      )}

      {/* ── Range Loss Chart ──────────────────────────── */}
      {rangeData.length > 0 ? (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <div className="mb-4 text-sm font-semibold">
              {t('battery.degradation.rangeLoss', 'Range Loss Over Time')}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={rangeData}>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <defs>
                  <linearGradient id="origRange" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="curRange" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[2]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS[2]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="original"
                  name={t('Original Range')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#origRange)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  name={t('Current Range')}
                  stroke={CHART_COLORS[2]}
                  fill="url(#curRange)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      ) : (
        <FadeIn delay={0.2}>
          <EmptyState
            icon={<Battery className="h-12 w-12" />}
            message={t('battery.degradation.noRange', 'Range data will appear once history is available.')}
          />
        </FadeIn>
      )}

      {/* ── Risk Factors ──────────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-neon-amber" />
            {t('battery.degradation.riskFactors', 'Risk Factors')}
          </div>
          <Grid cols={{ default: 2, sm: 4 }} gap={3}>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                {t('battery.degradation.risk.fastCharges', 'Fast Charges')}
              </p>
              <p className={cn('text-2xl font-bold',
                riskLevel(habits?.fast_charge_count ?? 0, 20, 50) === 'success' ? 'text-neon-green' :
                riskLevel(habits?.fast_charge_count ?? 0, 20, 50) === 'warning' ? 'text-neon-amber' : 'text-neon-red'
              )}>
                {habits?.fast_charge_count ?? 0}
              </p>
              <p className="text-[10px] text-white/40">{fastChargePct}% {t('battery.degradation.ofAll', 'of all charges')}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                {t('battery.degradation.risk.deepDischarges', 'Deep Discharges')}
              </p>
              <p className={cn('text-2xl font-bold',
                riskLevel(habits?.deep_discharge_count ?? 0, 5, 15) === 'success' ? 'text-neon-green' :
                riskLevel(habits?.deep_discharge_count ?? 0, 5, 15) === 'warning' ? 'text-neon-amber' : 'text-neon-red'
              )}>
                {habits?.deep_discharge_count ?? 0}
              </p>
              <p className="text-[10px] text-white/40">{t('battery.degradation.below10', 'Below 10% SOC')}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                {t('battery.degradation.risk.chargedFull', 'Charged to Full')}
              </p>
              <p className={cn('text-2xl font-bold',
                riskLevel(habits?.charge_to_full_count ?? 0, 10, 30) === 'success' ? 'text-neon-green' :
                riskLevel(habits?.charge_to_full_count ?? 0, 10, 30) === 'warning' ? 'text-neon-amber' : 'text-neon-red'
              )}>
                {habits?.charge_to_full_count ?? 0}
              </p>
              <p className="text-[10px] text-white/40">{t('battery.degradation.above95', 'Above 95% SOC')}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                {t('battery.degradation.risk.cellTemp', 'Avg Cell Temp')}
              </p>
              <p className={cn('text-2xl font-bold',
                (degradation?.current_temp ?? 25) > 40 ? 'text-neon-red' :
                (degradation?.current_temp ?? 25) > 35 ? 'text-neon-amber' : 'text-neon-green'
              )}>
                {fmtNumber(degradation?.current_temp ?? 0)}°C
              </p>
              <p className="text-[10px] text-white/40">
                {(degradation?.current_temp ?? 25) <= 35
                  ? t('battery.degradation.optimalRange', 'Optimal range')
                  : t('battery.degradation.elevated', 'Elevated')}
              </p>
            </GlassPanel>
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* ── Charging Habits Impact ─────────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-neon-green" />
            {t('battery.degradation.chargingImpact', 'Charging Habits Impact')}
          </div>
          <AlertBanner
            variant={
              degradation?.stress_level === 'Low' ? 'success' :
              degradation?.stress_level === 'Medium' ? 'warning' : 'danger'
            }
            icon={<Thermometer className="h-5 w-5" />}
            title={`${fastChargePct}% ${t('battery.degradation.fastCharges', 'fast charges')}, ${habits?.deep_discharge_count ?? 0} ${t('battery.degradation.deepDischarges', 'deep discharges')} — ${degradation?.stress_level ?? 'Unknown'} ${t('battery.degradation.stressLabel', 'stress')}`}
          >
            {degradation?.stress_level === 'Low'
              ? t('battery.degradation.stressLow', 'Your charging habits are optimal for battery longevity.')
              : degradation?.stress_level === 'Medium'
              ? t('battery.degradation.stressMedium', 'Consider reducing fast charging frequency and avoiding full charges when possible.')
              : t('battery.degradation.stressHigh', 'High stress detected. Reducing fast charges and deep discharges can improve battery lifespan.')}
          </AlertBanner>
        </GlassPanel>
      </FadeIn>

      {/* ── Battery Health Factors ────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-neon-amber" />
            {t('Battery Health Factors')}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Charge habits */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Charge Habits')}
                </span>
                <Badge variant={scoreVariant(data?.charge_habits_score ?? 0)} size="sm">
                  {fmtNumber(data?.charge_habits_score ?? 0)}/100
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <span>{t('Fast Charge')}</span>
                  <span className="font-medium">{fmtNumber(data?.fast_charge_pct ?? 0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('Full Charge')}</span>
                  <span className="font-medium">{fmtNumber(data?.full_charge_pct ?? 0)}%</span>
                </div>
              </div>
            </GlassPanel>

            {/* Temperature exposure */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Temperature Exposure')}
                </span>
                <Badge variant={scoreVariant(data?.temp_exposure_score ?? 0)} size="sm">
                  {fmtNumber(data?.temp_exposure_score ?? 0)}/100
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Thermometer className="h-3 w-3" />
                {t('Lower is better for longevity')}
              </div>
            </GlassPanel>

            {/* Cycle depth */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Cycle Depth')}
                </span>
                <Badge variant={scoreVariant(cycleDepthScore)} size="sm">
                  {fmtNumber(cycleDepthScore)}/100
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <span>{t('Avg DoD')}</span>
                  <span className="font-medium">
                    {fmtNumber(data?.avg_depth_of_discharge ?? 0)}%
                  </span>
                </div>
              </div>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Degradation History Table ─────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-6">
          <div className="mb-4 text-sm font-semibold">
            {t('Degradation History')}
          </div>
          {data?.history && data.history.length > 0 ? (
            <DataTable
              columns={columns}
              data={data.history}
              keyExtractor={(row: DegradationEntry) =>
                `${row.date}-${row.odometer}`
              }
              emptyMessage={t('No degradation records found.')}
              compact
              pagination
            />
          ) : (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              message={t('battery.degradation.noHistory', 'No degradation records found.')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
