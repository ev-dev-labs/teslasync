import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, Calendar, AlertTriangle,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import {
  GlassPanel, Badge, DataTable, type Column,
} from '@/components/ui';
import { MetricCard, DataFreshnessAuto } from '@/components/data-display';
import {
  RadialGauge, ChartContainer, ChartLegend, ChartTooltip, renderAnnotationLines,
  chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS, areaGradient,
  ChartBrush,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
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
  if (score <= 25) return 'text-emerald-300';
  if (score <= 50) return 'text-amber-300';
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

  /* Vehicle selector — Phase 40 / Prompt 16: header picker is the source of truth */
  const { vehicleId: activeId } = useSelectedVehicle();
  const activeIdStr = activeId != null ? String(activeId) : null;

  /* Battery health analytics (for overview stats, history table) */
  const healthQuery = useBatteryHealthAnalytics(activeIdStr);
  const { data, isLoading, error } = healthQuery;

  /* Degradation data (for prediction, risk factors, trend) */
  const { data: degradation } = useBatteryDegradation(activeIdStr);

  /* Phase-46 / Prompt 67 — URL-persisted hidden-series state for the
     trend chart so users can declutter (and share) the projection view. */
  const trendHidden = useHiddenSeries('battery-degradation-trend');

  /* Phase-43 / Prompt 0023 — backend `range_km` and `odometer` fields are
     derived SI in km. Convert km → metres → user-pref display via the
     SI-canonical helper so users with `unit_of_length=mi` see miles
     (the legacy useSettings.convertDistance helper expected miles input
     and would silently double-convert here). */
  const { unitPrefs } = useUnits();
  const fromKm = useCallback(
    (km: number): number => convertDistanceFromSI(km * 1000, unitPrefs.distance),
    [unitPrefs.distance],
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
        render: (row: DegradationEntry) => `${fmtNumber(fromKm(row.odometer))} ${unitPrefs.distance}`,
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
        render: (row: DegradationEntry) => `${fmtNumber(fromKm(row.range_km))} ${unitPrefs.distance}`,
        sortable: true,
      },
    ],
    [t, fromKm, unitPrefs.distance],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Battery Degradation')}
      subtitle={t('Health trends, degradation predictions, and charging habit impact')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        // Battery health analytics derive from a daily cagg; force amber after 24h.
        <DataFreshnessAuto query={healthQuery} forceStaleAfterMs={24 * 60 * 60 * 1000} />
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
            help={{
              i18nKey: 'help.battery.soh',
              defaultValue:
                'State of Health — current usable capacity divided by the original rated capacity, expressed as a percentage. Higher is better; new packs start at 100%.',
            }}
          />
          <MetricCard
            label={t('Estimated Capacity')}
            value={`${fmtNumber(data?.estimated_capacity ?? 0)} kWh`}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
            help={{
              i18nKey: 'help.battery.capacity',
              defaultValue:
                'Estimated current usable energy capacity of the pack in kWh, derived from the SoH and the original rated capacity.',
            }}
          />
          <MetricCard
            label={t('Degradation Rate')}
            value={`${fmtNumber(data?.degradation_rate_yr ?? 0)}%/yr`}
            icon={<TrendingDown className="h-4 w-4" />}
            color="purple"
            help={{
              i18nKey: 'help.battery.degradationRate',
              defaultValue:
                'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
            }}
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
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t('battery.degradation.predictionDesc', 'At current rate, battery reaches')}{' '}
                    <span className="font-bold text-amber-300">80%</span>{' '}
                    {t('battery.degradation.inApprox', 'in approximately')}{' '}
                    <span className="font-bold text-purple-300">
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
                    help={{
                      i18nKey: 'help.battery.degradationRate',
                      defaultValue:
                        'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
                    }}
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
                    help={{
                      i18nKey: 'help.battery.totalCycles',
                      defaultValue:
                        'Cumulative full-pack equivalent cycles. One cycle = one full discharge + one full charge worth of energy (partial cycles add up over time).',
                    }}
                  />
                  <MetricCard
                    label={t('battery.degradation.avgDoD', 'Avg Depth of Discharge')}
                    value={`${fmtNumber(data?.avg_depth_of_discharge ?? 0)}%`}
                    color="purple"
                    help={{
                      i18nKey: 'help.battery.avgDoD',
                      defaultValue:
                        'Average Depth of Discharge per cycle — how deeply the pack is typically discharged before being recharged. Shallower cycles cause less wear.',
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl p-4 bg-white/[0.02] text-center">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-neon-amber/50" />
                <p className="text-sm text-[var(--text-secondary)]">
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
          {/* chart-a11y:no-table composed projection chart with confidence band; SR users get summary metrics in the cards above */}
          <ChartContainer
            title={t('battery.degradation.trendTitle', 'Health Trend & Projection')}
            ariaLabel={t('battery.degradation.trendTitle.aria', 'Battery health trend and 95% confidence projection chart')}
            height={300}
            chartKey="battery-degradation-trend"
            annotations={{ vehicleId: activeId, scope: 'battery', chartId: 'battery-degradation-trend' }}
          >
            {({ annotations: chartAnnotations }) => (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={projectionChartData}>
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
                  <ChartLegend state={trendHidden} />
                  <ReferenceLine
                    y={80}
                    stroke="#f59e0b"
                    strokeDasharray="6 4"
                    label={{ value: t('battery.degradation.warranty', '80% Warranty'), fill: '#f59e0b', fontSize: 11, position: 'insideTopRight' }}
                  />
                  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="6 4" />
                  {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                  {/* Confidence band (stacked areas: transparent base + visible band) */}
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="confidence_low"
                    stackId="ci"
                    stroke="none"
                    fill="transparent"
                    fillOpacity={0}
                    legendType="none"
                    connectNulls={false}
                  />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="confidence_band"
                    stackId="ci"
                    stroke="none"
                    fill="url(#ciBand)"
                    name={t('battery.degradation.confidence', '95% Confidence')}
                    connectNulls={false}
                    hide={trendHidden.isHidden('confidence_band')}
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="health"
                    name={t('battery.degradation.actualHealth', 'Actual Health %')}
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ fill: '#10b981', r: 3 }}
                    connectNulls={false}
                    hide={trendHidden.isHidden('health')}
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="projected"
                    name={t('battery.degradation.projected', 'Projected %')}
                    stroke="#a855f7"
                    strokeDasharray="8 4"
                    connectNulls={false}
                    hide={trendHidden.isHidden('projected')}
                  />
                  {/*
                    Phase 40 / Prompt 26: brush enables zooming into specific
                    months of the projection. Standalone chart — no
                    ChartTimeRangeProvider needed since the range chart below
                    uses a different X-axis dataKey ("date" vs "label").
                  */}
                  <ChartBrush dataKey="label" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
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
                {areaGradient('origRange', CHART_COLORS[0], 0.25)}
                {areaGradient('curRange', CHART_COLORS[2])}
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="original"
                  name={t('Original Range')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#origRange)"
                />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="current"
                  name={t('Current Range')}
                  stroke={CHART_COLORS[2]}
                  fill="url(#curRange)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      ) : (
        <FadeIn delay={0.2}>
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
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
                    <p className="text-[10px] text-[var(--text-secondary)]">{rf.detail}</p>
                  </GlassPanel>
                );
              })}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
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
                  <p className="text-sm text-[var(--text-primary)]">{rec}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
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
              tableId="battery:degradation-history"
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
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
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
