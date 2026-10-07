import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, AlertTriangle,
} from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard } from '@/components/layout';
import { BatteryDegradationStats, DegradationGrid } from '../components/battery-degradation-modernization';

import {
  GlassPanel, Badge, DataTable, Text, Caption, HelpTooltip, type Column,
} from '@/components/ui';
import { MetricBar, DataFreshnessAuto } from '@/components/data-display';
import {
  LinearGauge, ChartLegend, ChartTooltip, EmbeddedChart, renderAnnotationLines,
  chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  AREA_DEFAULTS, areaGradient,
  ChartBrush,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, AlertBanner, StaleRefreshWarning, ActionableEmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';

import { cn } from '@/lib/cn';
import type { BatteryHealthSnapshot, RiskFactorData } from '@/types/energy';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

/* ── Types ─────────────────────────────────────────────── */

type DegradationEntry = BatteryHealthSnapshot;

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

/* Toned 300-level accents for the risk icon + score glyph — neon hues are
   reserved for chips/borders/dots, never for content per the design language. */
function riskScoreColor(score: number): string {
  if (score <= 25) return 'text-emerald-300';
  if (score <= 50) return 'text-amber-300';
  return 'text-rose-300';
}

/* Hex fill for the shared <MetricBar> gradient (it takes a color string,
   not a Tailwind class). */
function riskBarHex(score: number): string {
  if (score <= 25) return '#10b981';
  if (score <= 50) return '#f59e0b';
  return '#ef4444';
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

/* ── Page ──────────────────────────────────────────────── */

export default function BatteryDegradationPage() {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('battery.degradation.title', 'Battery degradation'));

  /* Vehicle selector: header picker is the source of truth. */
  const { vehicleId: activeId } = useSelectedVehicle();
  const activeIdStr = activeId != null ? String(activeId) : null;

  /* Battery health analytics (overview stats, range chart, history table). */
  const healthQuery = useBatteryHealthAnalytics(activeIdStr);
  const healthState = useDataState(healthQuery, {
    provenance: 'inferred',
    maxAgeMs: 24 * 60 * 60 * 1000,
  });
  const { data, fatalError } = healthState;
  const initialLoading = !healthState.hasData && healthQuery.isLoading;

  /* URL-persisted hidden-series state lets users declutter and share
     the projection view. */
  const trendHidden = useHiddenSeries('battery-degradation-trend');

  /* Capacity, range, and odometer values remain SI until this display boundary. */
  const { unitPrefs, formatEnergy } = useUnits();
  const fromMeters = useCallback(
    (meters: number): number => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );

  /* Range-loss chart data */
  const rangeData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];
    const originalRange = data.history[0].range_m != null && Number.isFinite(data.history[0].range_m)
      ? fromMeters(data.history[0].range_m) : null;
    return data.history.map((h) => ({
      date: formatDate(h.date),
      original: originalRange,
      current: h.range_m != null && Number.isFinite(h.range_m) ? fromMeters(h.range_m) : null,
    }));
  }, [data, fromMeters]);

  /* Projection chart: actual history + predicted future with confidence band */
  const projectionChartData = useMemo(() => {
    const hist = (data?.history ?? []).map((h) => ({
      label: formatDate(h.date),
      health: h.soh_pct,
      projected: undefined as number | undefined,
      confidence_low: undefined as number | undefined,
      confidence_band: undefined as number | undefined,
    }));
    const projections = data?.projections ?? [];
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
  }, [data]);

  const habits = data?.charging_habits;
  const totalCharges = habits?.fast_charge_count != null && habits?.slow_charge_count != null
    ? habits.fast_charge_count + habits.slow_charge_count : null;
  const fastChargePct = totalCharges != null && totalCharges > 0 && habits
    ? fmtInt((habits.fast_charge_count / totalCharges) * 100) : '—';

  const cycleDepthScore = data?.avg_depth_of_discharge_pct != null
    ? Math.max(0, Math.round(100 - data.avg_depth_of_discharge_pct))
    : null;

  const riskFactors = data?.risk_factors ?? [];
  const recommendations = data?.recommendations ?? [];
  const stressLevel = data?.stress_level;
  const soh = data?.current_soh;

  /* Table columns */
  const columns: Column<DegradationEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        filterValue: (row) => row.date ?? null,
        filterValueLabel: (_, row) => formatDate(row.date),
        header: t('battery.degradation.date', 'Date'),
        render: (row: DegradationEntry) => formatDate(row.date),
        sortable: true,
      },
      {
        key: 'odometer_m',
        align: 'right',
        filterValue: (row) => row.odometer_m ?? null,
        filterValueLabel: (_, row) => row.odometer_m != null ? `${fmtNumber(fromMeters(row.odometer_m))} ${unitPrefs.distance}` : '—',
        header: t('battery.degradation.odometer', 'Odometer'),
        render: (row: DegradationEntry) => row.odometer_m != null ? `${fmtNumber(fromMeters(row.odometer_m))} ${unitPrefs.distance}` : '—',
        sortable: true,
      },
      {
        key: 'soh_pct',
        align: 'right',
        filterValue: (row) => row.soh_pct ?? null,
        filterValueLabel: (_, row) => row.soh_pct != null ? `${fmtNumber(row.soh_pct)}%` : '—',
        header: t('battery.degradation.sohPct', 'SOH %'),
        render: (row: DegradationEntry) => (
          <Badge
            variant={
              row.soh_pct == null
                ? 'neutral'
                : row.soh_pct > 90
                ? 'success'
                : row.soh_pct >= 80
                  ? 'warning'
                  : 'danger'
            }
          >
            {row.soh_pct != null ? fmtNumber(row.soh_pct) : '—'}%
          </Badge>
        ),
        sortable: true,
      },
      {
        key: 'capacity_wh',
        align: 'right',
        filterValue: (row) => row.capacity_wh ?? null,
        filterValueLabel: (_, row) => formatEnergy(row.capacity_wh),
        header: t('battery.degradation.capacity', 'Capacity'),
        render: (row: DegradationEntry) =>
          formatEnergy(row.capacity_wh),
        sortable: true,
      },
      {
        key: 'range_m',
        align: 'right',
        filterValue: (row) => row.range_m ?? null,
        filterValueLabel: (_, row) => row.range_m != null ? `${fmtNumber(fromMeters(row.range_m))} ${unitPrefs.distance}` : '—',
        header: t('battery.degradation.range', 'Range'),
        render: (row: DegradationEntry) => row.range_m != null ? `${fmtNumber(fromMeters(row.range_m))} ${unitPrefs.distance}` : '—',
        sortable: true,
      },
    ],
    [t, fromMeters, unitPrefs.distance, formatEnergy, fmtNumber],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageLayout
      title={t('battery.degradation.title', 'Battery degradation')}
      subtitle={t('battery.degradation.subtitle', 'Health trends, degradation predictions, and charging habit impact')}
      metadataActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Battery health analytics derive from a daily cagg; force amber after 24h. */}
          <DataFreshnessAuto query={healthQuery} forceStaleAfterMs={24 * 60 * 60 * 1000} />
        </div>
      }
    >
      <StaleRefreshWarning
        state={healthState}
        label={t('battery.degradation.title', 'Battery degradation')}
      />
      {!healthState.hasData && healthState.isRefreshBlocked ? (
        <AlertBanner variant="warning" title={t('dataState.stale.title', 'Data may be stale')}>
          {t('battery.degradation.initialPaused', 'Battery analytics loading is paused. Reconnect to load this vehicle’s history.')}
        </AlertBanner>
      ) : null}
      {/* ── 1 · KPI band ─────────────────────────────────── */}
      <FadeIn>
        <section aria-label={t('battery.degradation.summary', 'Battery health summary')}>
          {fatalError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={fatalError} />
            </GlassPanel>
          ) : (
            <BatteryDegradationStats data={data} loading={initialLoading} />
          )}
        </section>
      </FadeIn>

      {/* ── 2 · Hero: Health gauge + Trend & Projection ──── */}
      <FadeIn delay={0.05}>
        <DegradationGrid
          label={t('battery.degradation.trendTitle', 'Health trend & projection')}
          sizes={['third', 'half']}
        >
          {/* Health gauge */}
          <LayoutCard
            title={t('battery.degradation.healthTitle', 'Battery health')}
            size="third"
            actions={
              <HelpTooltip
                i18nKey="help.battery.soh"
                defaultValue="State of Health — current usable capacity divided by the original rated capacity, expressed as a percentage. Higher is better; new packs start at 100%."
                className="min-h-11 min-w-11"
              />
            }
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
              {fatalError ? (
                <QueryError error={fatalError} />
              ) : initialLoading ? (
                <Skeleton height={200} />
              ) : soh != null && Number.isFinite(soh) ? (
                <>
                  <LinearGauge
                    value={soh}
                    max={100}
                    label={t('battery.degradation.currentSoh', 'Current SOH')}
                    unit="%"
                    color={sohColor(soh)}
                    size={180}
                  />
                  <Badge
                    variant={soh > 90 ? 'success' : soh >= 80 ? 'warning' : 'danger'}
                  >
                    {soh > 90
                      ? t('battery.health.excellent', 'Excellent')
                      : soh >= 80
                        ? t('battery.health.good', 'Good')
                        : t('battery.health.degraded', 'Degraded')}
                  </Badge>
                </>
              ) : (
                <EmptyState
                  message={t('battery.degradation.noSoh', 'Battery health is not available yet.')}
                  action={{ label: t('common.refresh', 'Refresh'), onClick: () => { void healthQuery.refetch(); } }}
                />
              )}
            </div>
          </LayoutCard>

          {/* Trend & projection chart (hero — spans 2 cols on wide screens) */}
          {(
            /* chart-a11y:no-table composed projection chart with confidence band; SR users get summary metrics in the cards above */
            <ChartCard
              toolbar exportable size="standard"
              title={t('battery.degradation.trendTitle', 'Health trend & projection')}
              ariaLabel={t('battery.degradation.trendTitle.aria', 'Battery health trend and 95% confidence projection chart')}
              height={300}
              chartKey="battery-degradation-trend"
              loading={initialLoading}
              error={fatalError}
              onRetry={healthState.retry ?? undefined}
              empty={projectionChartData.length === 0}
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
                      label={{ value: t('battery.degradation.warranty', '80% warranty'), fill: '#f59e0b', fontSize: 11, position: 'insideTopRight' }}
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
                      name={t('battery.degradation.confidence', '95% confidence')}
                      connectNulls={false}
                      hide={trendHidden.isHidden('confidence_band')}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="health"
                      name={t('battery.degradation.actualHealth', 'Actual health %')}
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
                      Brush enables zooming into specific months of the
                      projection. Standalone chart — no ChartTimeRangeProvider
                      needed since the range chart below uses a different X-axis
                      dataKey ("date" vs "label").
                    */}
                    <ChartBrush dataKey="label" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          )}
        </DegradationGrid>
      </FadeIn>

      {/* ── 3 · Prediction + Charging Habits Impact ──────── */}
      <FadeIn delay={0.1}>
        <DegradationGrid
          label={t('battery.degradation.predictionAndHabits', 'Prediction and charging habits')}
          sizes={['half', 'third']}
        >
          {/* Prediction (spans 2 cols on wide screens) */}
          <LayoutCard title={t('battery.degradation.prediction', 'Prediction')} size="half">
            {initialLoading ? (
              <Skeleton height={220} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : data?.prediction?.has_enough_data ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-neon-purple/15 bg-neon-purple/[0.08] p-4">
                  <Text as="p" variant="bodySm">
                    {t('battery.degradation.predictionDesc', 'At current rate, battery reaches')}{' '}
                    <Text weight="semibold" className="text-amber-300">80%</Text>{' '}
                    {t('battery.degradation.inApprox', 'in approximately')}{' '}
                    <Text weight="semibold" className="text-purple-300">
                      {data.prediction.years_to_80_pct != null && Number.isFinite(data.prediction.years_to_80_pct)
                        ? `~${fmtNumber(data.prediction.years_to_80_pct)}` : '—'} {t('battery.degradation.years', 'years')}
                    </Text>
                    {data.prediction.predicted_date && (
                      <> ({data.prediction.predicted_date})</>
                    )}
                  </Text>
                </div>
                <BatteryDegradationStats data={data} prediction />
              </div>
            ) : (
              <EmptyState /* no-action: prediction needs a minimum snapshot count that isn't met yet */
                icon={<AlertTriangle className="h-8 w-8" />}
                message={t('battery.degradation.needMore', 'Need more data points to generate prediction (minimum 3 snapshots required)')}
              />
            )}
          </LayoutCard>

          {/* Charging habits impact */}
          <LayoutCard title={t('battery.degradation.chargingImpact', 'Charging habits impact')} size="third">
            {initialLoading ? (
              <Skeleton height={120} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : habits && stressLevel != null ? (
              <AlertBanner
                variant={
                  stressLevel === 'Low' ? 'success' :
                  stressLevel === 'Medium' ? 'warning' : 'danger'
                }
                icon={<Thermometer className="h-5 w-5" aria-hidden="true" />}
                title={`${fastChargePct}% ${t('battery.degradation.fastCharges', 'fast charges')}, ${habits.deep_discharge_count != null ? fmtInt(habits.deep_discharge_count) : '—'} ${t('battery.degradation.deepDischarges', 'deep discharges')} — ${t(`battery.degradation.stressValue.${stressLevel}`, stressLevel)} ${t('battery.degradation.stressLabel', 'stress')}`}
              >
                {stressLevel === 'Low'
                  ? t('battery.degradation.stressLow', 'Your charging habits are optimal for battery longevity.')
                  : stressLevel === 'Medium'
                    ? t('battery.degradation.stressMedium', 'Consider reducing fast charging frequency and avoiding full charges when possible.')
                    : t('battery.degradation.stressHigh', 'High stress detected. Reducing fast charges and deep discharges can improve battery lifespan.')}
              </AlertBanner>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when charging history is missing */
                icon={<Zap className="h-8 w-8" />}
                message={t('battery.degradation.noStress', 'Charging impact will appear once charging history is available.')}
              />
            )}
          </LayoutCard>
        </DegradationGrid>
      </FadeIn>

      {/* ── 4 · Analysis: Range loss + Risk factors ──────── */}
      <FadeIn delay={0.15}>
        <DegradationGrid
          label={t('battery.degradation.analysis', 'Range and risk analysis')}
          sizes={['half', 'half']}
        >
          {/* Range loss over time */}
          <LayoutCard title={t('battery.degradation.rangeLoss', 'Range loss over time')} size="half">
            {initialLoading ? (
              <Skeleton height={240} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : rangeData.length > 0 ? (
              <EmbeddedChart
                title={t('battery.degradation.rangeLoss', 'Range loss over time')}
                ariaLabel={t(
                  'battery.degradation.rangeLossAria',
                  'Original and current estimated driving range over time',
                )}
                data={rangeData}
                dataColumns={[
                  { key: 'date', label: t('battery.degradation.date', 'Date') },
                  { key: 'original', label: t('battery.degradation.originalRange', 'Original range') },
                  { key: 'current', label: t('battery.degradation.currentRange', 'Current range') },
                ]}
                chartKey="battery-degradation-range-loss"
                fluid={false}
                mobileHeight={224}
                height={288}
              >
                {({ hiddenSeries }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rangeData}>
                    {chartGrid}
                    <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit={` ${unitPrefs.distance}`} />
                    <Tooltip content={<ChartTooltip valueFormatter={(value) =>
                      typeof value === 'number' ? `${fmtNumber(value)} ${unitPrefs.distance}` : '—'
                    } />} />
                    <ChartLegend />
                    {areaGradient('origRange', CHART_COLORS[0], 0.25)}
                    {areaGradient('curRange', CHART_COLORS[2])}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="original"
                      name={t('battery.degradation.originalRange', 'Original range')}
                      stroke={CHART_COLORS[0]}
                      fill="url(#origRange)"
                      hide={hiddenSeries?.isHidden('original')}
                    />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="current"
                      name={t('battery.degradation.currentRange', 'Current range')}
                      stroke={CHART_COLORS[2]}
                      fill="url(#curRange)"
                      hide={hiddenSeries?.isHidden('current')}
                    />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </EmbeddedChart>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Battery className="h-8 w-8" />}
                message={t('battery.degradation.noRange', 'Range data will appear once history is available.')}
              />
            )}
          </LayoutCard>

          {/* Risk factors (scored bars) */}
          <LayoutCard title={t('battery.degradation.riskFactors', 'Risk factors')} size="half">
            {initialLoading ? (
              <Skeleton height={200} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : riskFactors.length > 0 ? (
              <DegradationGrid
                label={t('battery.degradation.riskFactors', 'Risk factors')}
                sizes={riskFactors.map(() => 'half')}
              >
                {riskFactors.map((rf: RiskFactorData) => {
                  const Icon = riskFactorIcon(rf.name);
                  return (
                    <GlassPanel key={rf.name} className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className={cn('h-4 w-4 shrink-0', riskScoreColor(rf.score))} aria-hidden="true" />
                          <Text variant="bodySm" className="break-words">
                            {t(`battery.degradation.risk.${rf.name}`, rf.name.replace(/_/g, ' '))}
                          </Text>
                        </div>
                        <Badge variant={riskBadgeVariant(rf.score)} size="sm">
                          {rf.label}
                        </Badge>
                      </div>
                      <MetricBar
                        label={t('battery.degradation.riskScore', 'Risk score')}
                        value={rf.score}
                        max={100}
                        color={riskBarHex(rf.score)}
                        sublabel={`${rf.score}/100`}
                      />
                      <Caption className="mt-2 block">{rf.detail}</Caption>
                    </GlassPanel>
                  );
                })}
              </DegradationGrid>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when charging history is missing */
                icon={<Shield className="h-8 w-8" />}
                message={t('battery.degradation.noRiskData', 'Risk data will appear once charging history is available.')}
              />
            )}
          </LayoutCard>
        </DegradationGrid>
      </FadeIn>

      {/* ── 5 · Guidance: Recommendations + Health factors ─ */}
      <FadeIn delay={0.2}>
        <DegradationGrid
          label={t('battery.degradation.guidance', 'Recommendations and health factors')}
          sizes={['half', 'half']}
        >
          {/* Recommendations */}
          <LayoutCard title={t('battery.degradation.recommendations', 'Recommendations')} size="half">
            {initialLoading ? (
              <Skeleton height={120} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : recommendations.length > 0 ? (
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-xl border border-neon-amber/10 bg-neon-amber/[0.05] p-3">
                    <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <Text as="p" variant="body">{rec}</Text>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces once usage patterns exist */
                icon={<AlertTriangle className="h-8 w-8" />}
                message={t('battery.degradation.noRecommendations', 'Recommendations will appear based on your usage patterns.')}
              />
            )}
          </LayoutCard>

          {/* Battery health factors */}
          <LayoutCard title={t('battery.degradation.healthFactors', 'Battery health factors')} size="half">
            {initialLoading ? (
              <Skeleton height={140} />
            ) : fatalError ? (
              <QueryError error={fatalError} />
            ) : (
              <DegradationGrid
                label={t('battery.degradation.healthFactors', 'Battery health factors')}
                sizes={['third', 'third', 'third']}
              >
                {/* Charge habits */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('battery.degradation.chargeHabits', 'Charge habits')}</Text>
                    <Badge variant={data?.charge_habits_score != null ? scoreVariant(data.charge_habits_score) : 'neutral'} size="sm">
                      {data?.charge_habits_score != null ? fmtNumber(data.charge_habits_score) : '—'}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <Caption>{t('battery.degradation.fastCharge', 'Fast charge')}</Caption>
                      <Caption className="font-medium">{data?.fast_charge_pct != null ? fmtNumber(data.fast_charge_pct) : '—'}%</Caption>
                    </div>
                    <div className="flex justify-between gap-2">
                      <Caption>{t('battery.degradation.fullCharge', 'Full charge')}</Caption>
                      <Caption className="font-medium">{data?.full_charge_pct != null ? fmtNumber(data.full_charge_pct) : '—'}%</Caption>
                    </div>
                  </div>
                </GlassPanel>

                {/* Temperature exposure */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('battery.degradation.tempExposure', 'Temperature exposure')}</Text>
                    <Badge variant={data?.temp_exposure_score != null ? scoreVariant(data.temp_exposure_score) : 'neutral'} size="sm">
                      {data?.temp_exposure_score != null ? fmtNumber(data.temp_exposure_score) : '—'}/100
                    </Badge>
                  </div>
                  {data?.temp_exposure_reason != null && (
                    <Caption className="mt-2 block break-words">{data.temp_exposure_reason}</Caption>
                  )}
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                    <Caption>{t('battery.degradation.lowerBetter', 'Lower is better for longevity')}</Caption>
                  </div>
                </GlassPanel>

                {/* Cycle depth */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('battery.degradation.cycleDepth', 'Cycle depth')}</Text>
                    <Badge variant={cycleDepthScore != null ? scoreVariant(cycleDepthScore) : 'neutral'} size="sm">
                      {cycleDepthScore != null ? fmtNumber(cycleDepthScore) : '—'}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <Caption>{t('battery.degradation.avgDoDLabel', 'Avg DoD')}</Caption>
                      <Caption className="font-medium">
                        {data?.avg_depth_of_discharge_pct != null ? fmtNumber(data.avg_depth_of_discharge_pct) : '—'}%
                      </Caption>
                    </div>
                  </div>
                </GlassPanel>
              </DegradationGrid>
            )}
          </LayoutCard>
        </DegradationGrid>
      </FadeIn>

      {/* ── 6 · Detail: Degradation history table ────────── */}
      <FadeIn delay={0.25}>
        <LayoutCard title={t('battery.degradation.history', 'Degradation history')}>
          {initialLoading ? (
            <Skeleton height={240} />
          ) : fatalError ? (
            <QueryError error={fatalError} />
          ) : (data?.history?.length ?? 0) > 0 ? (
            <DataTable
              enableValueFilters
              name={t('battery.degradation.history', 'Degradation history')}
              rowLabel={(row: DegradationEntry) => formatDate(row.date)}
              tableId="battery:degradation-history"
              columns={columns}
              mobileColumns={['date', 'soh_pct']}
              mobilePresentation={{
                variant: 'cards',
                roles: {
                  date: 'title', soh_pct: 'primary', odometer_m: 'meta',
                  capacity_wh: 'meta', range_m: 'meta',
                },
                displayValue: (row, key) => {
                  switch (key) {
                    case 'date': return formatDate(row.date);
                    case 'soh_pct': return row.soh_pct != null ? `${fmtNumber(row.soh_pct)}%` : '—';
                    case 'odometer_m': return row.odometer_m != null ? `${fmtNumber(fromMeters(row.odometer_m))} ${unitPrefs.distance}` : '—';
                    case 'capacity_wh': return formatEnergy(row.capacity_wh);
                    case 'range_m': return row.range_m != null ? `${fmtNumber(fromMeters(row.range_m))} ${unitPrefs.distance}` : '—';
                    default: return null;
                  }
                },
              }}
              data={data?.history ?? []}
              keyExtractor={(row: DegradationEntry) =>
                `${row.date}-${row.odometer_m}`
              }
              emptyMessage={t('battery.degradation.noRecords', 'No degradation records found.')}
              compact
              pagination
            />
          ) : (
            // no-action: degradation history appears automatically after sufficient telemetry.
            <>
              <EmptyState
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.degradation.noHistory', 'No degradation records found.')}
                description={t(
                  'battery.degradation.noHistoryDescription',
                  'Capacity estimates appear after enough charging, range, and odometer snapshots have accumulated.',
                )}
                className="py-8"
              />
              {/* HELP-02 — governed prerequisite + likely cause for the
                  highest-anxiety empty state in the app: a user who cannot
                  see degradation data assumes the feature is broken, not
                  that the observation window is still too short. */}
              <ActionableEmptyState
                guidanceId="battery.degradation"
                fallbackMessage={t('battery.degradation.noHistory', 'No degradation records found.')}
                className="mx-auto"
              />
            </>
          )}
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
