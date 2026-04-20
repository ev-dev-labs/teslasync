import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, Calendar, AlertTriangle,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, renderAnnotationLines, AddAnnotationPopover, AnnotationList,
  chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnnotations } from '@/hooks/useAnnotations';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { RiskFactorData } from '@/types/energy';

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

function riskScoreColor(score: number): string {
  if (score <= 25) return 'text-neon-green';
  if (score <= 50) return 'text-neon-amber';
  return 'text-red-500';
}

function riskBarColor(score: number): string {
  if (score <= 25) return 'bg-neon-green';
  if (score <= 50) return 'bg-neon-amber';
  return 'bg-red-500';
}

function riskBadgeVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score <= 25) return 'success';
  if (score <= 50) return 'warning';
  return 'danger';
}

function riskFactorIcon(name: string) {
  switch (name) {
    case 'fast_charge_ratio': return Zap;
    case 'high_soc_charging': return Battery;
    case 'temperature_exposure': return Thermometer;
    case 'cycle_count_rate': return Activity;
    case 'deep_discharge_frequency': return TrendingDown;
    default: return Shield;
  }
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

  /* Annotations */
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations(
    'battery-degradation',
    activeId,
  );
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pendingTimestamp, setPendingTimestamp] = useState<string | null>(null);

  const handleChartClick = useCallback(
    (state: { activeLabel?: string }) => {
      if (isAnnotating && state?.activeLabel) {
        setPendingTimestamp(String(state.activeLabel));
      }
    },
    [isAnnotating],
  );

  const handleAddAnnotation = useCallback(
    (label: string, category: Parameters<typeof addAnnotation>[2], description?: string) => {
      if (pendingTimestamp) {
        addAnnotation(pendingTimestamp, label, category, description);
        setPendingTimestamp(null);
        setIsAnnotating(false);
      }
    },
    [pendingTimestamp, addAnnotation],
  );

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

  /* Projection chart: actual history + predicted future with confidence band */
  const projectionChartData = useMemo(() => {
    const hist = (data?.history ?? []).map((h) => ({
      label: formatDate(h.date),
      health: h.soh_pct,
      projected: undefined as number | undefined,
      confidence_low: undefined as number | undefined,
      confidence_band: undefined as number | undefined,
    }));
    const projections = degradation?.projections ?? [];
    const proj = projections.map((p) => ({
      label: p.date,
      health: undefined as number | undefined,
      projected: p.health_pct,
      confidence_low: p.confidence_low,
      confidence_band: Math.max(0, p.confidence_high - p.confidence_low),
    }));
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = { ...proj[0], health: hist[hist.length - 1].health };
    }
    return [...hist, ...proj];
  }, [data, degradation]);

  /* Risk factors from degradation data */
  const habits = degradation?.charging_habits;
  const totalCharges = (habits?.fast_charge_count ?? 0) + (habits?.slow_charge_count ?? 0);
  const fastChargePct = fmtInt(totalCharges > 0
    ? ((habits?.fast_charge_count ?? 0) / totalCharges) * 100
    : 0);

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
          <GlassPanel className={cn('p-6', isAnnotating && 'ring-1 ring-blue-400/30')}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">
                {t('battery.degradation.trendTitle', 'Health Trend & Projection')}
              </span>
              <button
                type="button"
                onClick={() => setIsAnnotating((v) => !v)}
                className={cn(
                  'rounded p-1 text-xs transition-colors',
                  isAnnotating
                    ? 'text-blue-400'
                    : 'text-white/30 hover:text-white/50',
                )}
                aria-label={t('annotation.toggle', 'Toggle annotations')}
                title={isAnnotating ? t('annotation.clickChart', 'Click on chart to annotate') : t('annotation.enable', 'Enable annotations')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
              </button>
            </div>
            <div className={isAnnotating ? 'cursor-crosshair' : undefined}>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={projectionChartData} onClick={handleChartClick}>
                  {chartGrid}
                  <defs>
                    <linearGradient id="ciBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis domain={[60, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <ReferenceLine
                    y={80}
                    stroke="#f59e0b"
                    strokeDasharray="6 4"
                    label={{ value: t('battery.degradation.warranty', '80% Warranty'), fill: '#f59e0b', fontSize: 11, position: 'insideTopRight' }}
                  />
                  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="6 4" />
                  {renderAnnotationLines(annotations, (ts) => ts)}
                  {/* Confidence band (stacked areas: transparent base + visible band) */}
                  <Area
                    type="monotone"
                    dataKey="confidence_low"
                    stackId="ci"
                    stroke="none"
                    fill="transparent"
                    fillOpacity={0}
                    legendType="none"
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="confidence_band"
                    stackId="ci"
                    stroke="none"
                    fill="url(#ciBand)"
                    name={t('battery.degradation.confidence', '95% Confidence')}
                    connectNulls={false}
                  />
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
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <AnnotationList annotations={annotations} onRemove={removeAnnotation} />
          </GlassPanel>
          <AddAnnotationPopover
            open={pendingTimestamp != null}
            timestamp={pendingTimestamp ?? ''}
            onAdd={handleAddAnnotation}
            onCancel={() => setPendingTimestamp(null)}
          />
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

      {/* ── Risk Factors (Scored Gauges) ────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-neon-amber" />
            {t('battery.degradation.riskFactors', 'Risk Factors')}
          </div>
          {(degradation?.risk_factors ?? []).length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(degradation?.risk_factors ?? []).map((rf: RiskFactorData) => {
                const Icon = riskFactorIcon(rf.name);
                return (
                  <GlassPanel key={rf.name} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon className={cn('h-4 w-4', riskScoreColor(rf.score))} />
                        <span className="text-xs font-medium capitalize">
                          {t(`battery.degradation.risk.${rf.name}`, rf.name.replace(/_/g, ' '))}
                        </span>
                      </div>
                      <Badge variant={riskBadgeVariant(rf.score)} size="sm">
                        {rf.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-1 relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', riskBarColor(rf.score))}
                          style={{ width: `${rf.score}%` }}
                        />
                      </div>
                      <span className={cn('text-sm font-bold tabular-nums', riskScoreColor(rf.score))}>
                        {rf.score}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/50">{rf.detail}</p>
                  </GlassPanel>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Shield className="h-8 w-8" />}
              message={t('battery.degradation.noRiskData', 'Risk data will appear once charging history is available.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Recommendations ────────────────────────────── */}
      <FadeIn delay={0.27}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-neon-amber" />
            {t('battery.degradation.recommendations', 'Recommendations')}
          </div>
          {(degradation?.recommendations ?? []).length > 0 ? (
            <div className="space-y-3">
              {(degradation?.recommendations ?? []).map((rec, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl p-3 bg-neon-amber/[0.05] border border-neon-amber/10">
                  <Zap className="h-4 w-4 mt-0.5 shrink-0 text-neon-amber" />
                  <p className="text-sm text-white/80">{rec}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<AlertTriangle className="h-8 w-8" />}
              message={t('battery.degradation.noRecommendations', 'Recommendations will appear based on your usage patterns.')}
            />
          )}
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
