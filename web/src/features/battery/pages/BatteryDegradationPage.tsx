import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, Calendar, AlertTriangle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel, Badge, DataTable, PanelTitle, Text, Caption, type Column,
} from '@/components/ui';
import { MetricCard, MetricBar, DataFreshnessAuto } from '@/components/data-display';
import {
  LinearGauge, ChartContainer, ChartLegend, ChartTooltip, renderAnnotationLines,
  chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, ComposedChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS, areaGradient,
  ChartBrush,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { BatteryHealthSnapshot, RiskFactorData } from '@/types/energy';

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

function ageLabel(
  months: number,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  /* Sanitise once: a missing/NaN/negative/fractional age must never surface
     as "NaN years" or "undefined months" — clamp to a whole, non-negative
     month count before formatting. */
  const m = Number.isFinite(months) ? Math.max(0, Math.round(months)) : 0;
  if (m < 12) return t('{{count}} months', { count: m });
  const years = Math.floor(m / 12);
  const rem = m % 12;
  return rem > 0
    ? t('{{y}}y {{m}}m', { y: years, m: rem })
    : t('{{y}} years', { y: years });
}

/* ── Page ──────────────────────────────────────────────── */

export default function BatteryDegradationPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.degradation.title', 'Battery Degradation'));

  /* Vehicle selector: header picker is the source of truth. */
  const { vehicleId: activeId } = useSelectedVehicle();
  const activeIdStr = activeId != null ? String(activeId) : null;

  /* Battery health analytics (overview stats, range chart, history table). */
  const healthQuery = useBatteryHealthAnalytics(activeIdStr);
  const { data } = healthQuery;

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
    const originalRange = fromMeters(data.history[0].range_m);
    return data.history.map((h) => ({
      date: formatDate(h.date),
      original: originalRange,
      current: fromMeters(h.range_m),
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
  const totalCharges = (habits?.fast_charge_count ?? 0) + (habits?.slow_charge_count ?? 0);
  const fastChargePct = fmtInt(totalCharges > 0
    ? ((habits?.fast_charge_count ?? 0) / totalCharges) * 100
    : 0);

  const cycleDepthScore = data
    ? Math.max(0, Math.round(100 - data.avg_depth_of_discharge_pct))
    : 0;

  const riskFactors = data?.risk_factors ?? [];
  const recommendations = data?.recommendations ?? [];
  const stressLevel = data?.stress_level ?? 'Low';
  const soh = data?.current_soh ?? 0;

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
        key: 'odometer_m',
        header: t('Odometer'),
        render: (row: DegradationEntry) => `${fmtNumber(fromMeters(row.odometer_m))} ${unitPrefs.distance}`,
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
        key: 'capacity_wh',
        header: t('Capacity'),
        render: (row: DegradationEntry) =>
          formatEnergy(row.capacity_wh, { precision: 1 }),
        sortable: true,
      },
      {
        key: 'range_m',
        header: t('Range'),
        render: (row: DegradationEntry) => `${fmtNumber(fromMeters(row.range_m))} ${unitPrefs.distance}`,
        sortable: true,
      },
    ],
    [t, fromMeters, unitPrefs.distance, formatEnergy],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('battery.degradation.title', 'Battery Degradation')}
      subtitle={t('battery.degradation.subtitle', 'Health trends, degradation predictions, and charging habit impact')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VehicleSelect />
          {/* Battery health analytics derive from a daily cagg; force amber after 24h. */}
          <DataFreshnessAuto query={healthQuery} forceStaleAfterMs={24 * 60 * 60 * 1000} />
        </div>
      }
    >
      {/* ── 1 · KPI band ─────────────────────────────────── */}
      <FadeIn>
        <section aria-label={t('battery.degradation.summary', 'Battery health summary')}>
          {healthQuery.error ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={healthQuery.error} />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {healthQuery.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)
              ) : (
                <>
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
                    value={formatEnergy(data?.estimated_capacity_wh ?? 0, { precision: 1 })}
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
                    value={`${fmtNumber(data?.degradation_rate_pct_per_year ?? 0)}%/yr`}
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
                </>
              )}
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── 2 · Hero: Health gauge + Trend & Projection ──── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('battery.degradation.trendTitle', 'Health Trend & Projection')}
          className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3"
        >
          {/* Health gauge */}
          <GlassPanel className="flex flex-col p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Battery className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('battery.degradation.healthTitle', 'Battery Health')}
            </PanelTitle>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
              {healthQuery.error ? (
                <QueryError error={healthQuery.error} />
              ) : healthQuery.isLoading ? (
                <Skeleton height={200} />
              ) : (
                <>
                  <LinearGauge
                    value={soh}
                    max={100}
                    label={t('Current SOH')}
                    unit="%"
                    color={sohColor(soh)}
                    size={180}
                  />
                  <Badge
                    variant={soh > 90 ? 'success' : soh >= 80 ? 'warning' : 'danger'}
                  >
                    {soh > 90
                      ? t('Excellent')
                      : soh >= 80
                        ? t('Good')
                        : t('Degraded')}
                  </Badge>
                </>
              )}
            </div>
          </GlassPanel>

          {/* Trend & projection chart (hero — spans 2 cols on wide screens) */}
          {healthQuery.error ? (
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3">
                {t('battery.degradation.trendTitle', 'Health Trend & Projection')}
              </PanelTitle>
              <QueryError error={healthQuery.error} />
            </GlassPanel>
          ) : (
            /* chart-a11y:no-table composed projection chart with confidence band; SR users get summary metrics in the cards above */
            <ChartContainer
              title={t('battery.degradation.trendTitle', 'Health Trend & Projection')}
              ariaLabel={t('battery.degradation.trendTitle.aria', 'Battery health trend and 95% confidence projection chart')}
              height={300}
              className="xl:col-span-2"
              chartKey="battery-degradation-trend"
              loading={healthQuery.isLoading}
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
                      Brush enables zooming into specific months of the
                      projection. Standalone chart — no ChartTimeRangeProvider
                      needed since the range chart below uses a different X-axis
                      dataKey ("date" vs "label").
                    */}
                    <ChartBrush dataKey="label" />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          )}
        </section>
      </FadeIn>

      {/* ── 3 · Prediction + Charging Habits Impact ──────── */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
          {/* Prediction (spans 2 cols on wide screens) */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('battery.degradation.prediction', 'Prediction')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={220} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
            ) : data?.prediction?.has_enough_data ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-neon-purple/15 bg-neon-purple/[0.08] p-4">
                  <Text as="p" variant="bodySm">
                    {t('battery.degradation.predictionDesc', 'At current rate, battery reaches')}{' '}
                    <Text weight="semibold" className="text-amber-300">80%</Text>{' '}
                    {t('battery.degradation.inApprox', 'in approximately')}{' '}
                    <Text weight="semibold" className="text-purple-300">
                      ~{fmtNumber(data.prediction.years_to_80_pct ?? 0)} {t('battery.degradation.years', 'years')}
                    </Text>
                    {data.prediction.predicted_date && (
                      <> ({data.prediction.predicted_date})</>
                    )}
                  </Text>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                  <MetricCard
                    label={t('battery.degradation.rate', 'Degradation Rate')}
                    value={`${fmtNumber(Math.abs(data.prediction.slope_per_year))}%/yr`}
                    color="red"
                    help={{
                      i18nKey: 'help.battery.degradationRate',
                      defaultValue:
                        'Annualised rate of capacity loss based on observed SoH trend. Combines calendar fade (time at temperature/SoC) and cycle fade (kWh throughput).',
                    }}
                  />
                  <MetricCard
                    label={t('battery.degradation.stress', 'Stress Level')}
                    value={stressLevel}
                    color={
                      stressLevel === 'Low' ? 'green' :
                      stressLevel === 'Medium' ? 'amber' : 'red'
                    }
                  />
                  <MetricCard
                    label={t('battery.degradation.totalCycles', 'Total Cycles')}
                    value={fmtNumber(data.total_cycles)}
                    color="cyan"
                    help={{
                      i18nKey: 'help.battery.totalCycles',
                      defaultValue:
                        'Cumulative full-pack equivalent cycles. One cycle = one full discharge + one full charge worth of energy (partial cycles add up over time).',
                    }}
                  />
                  <MetricCard
                    label={t('battery.degradation.avgDoD', 'Avg Depth of Discharge')}
                    value={`${fmtNumber(data.avg_depth_of_discharge_pct)}%`}
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
              <EmptyState /* no-action: prediction needs a minimum snapshot count that isn't met yet */
                icon={<AlertTriangle className="h-8 w-8" />}
                message={t('battery.degradation.needMore', 'Need more data points to generate prediction (minimum 3 snapshots required)')}
              />
            )}
          </GlassPanel>

          {/* Charging habits impact */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {t('battery.degradation.chargingImpact', 'Charging Habits Impact')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={120} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
            ) : data ? (
              <AlertBanner
                variant={
                  stressLevel === 'Low' ? 'success' :
                  stressLevel === 'Medium' ? 'warning' : 'danger'
                }
                icon={<Thermometer className="h-5 w-5" aria-hidden="true" />}
                title={`${fastChargePct}% ${t('battery.degradation.fastCharges', 'fast charges')}, ${habits?.deep_discharge_count ?? 0} ${t('battery.degradation.deepDischarges', 'deep discharges')} — ${stressLevel} ${t('battery.degradation.stressLabel', 'stress')}`}
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
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 4 · Analysis: Range loss + Risk factors ──────── */}
      <FadeIn delay={0.15}>
        <section className="grid grid-cols-1 gap-3 sm:gap-4 2xl:grid-cols-2">
          {/* Range loss over time */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Battery className="h-4 w-4 text-indigo-300" aria-hidden="true" />
              {t('battery.degradation.rangeLoss', 'Range Loss Over Time')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={240} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
            ) : rangeData.length > 0 ? (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
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
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing */
                icon={<Battery className="h-8 w-8" />}
                message={t('battery.degradation.noRange', 'Range data will appear once history is available.')}
              />
            )}
          </GlassPanel>

          {/* Risk factors (scored bars) */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('battery.degradation.riskFactors', 'Risk Factors')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={200} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
            ) : riskFactors.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2">
                {riskFactors.map((rf: RiskFactorData) => {
                  const Icon = riskFactorIcon(rf.name);
                  return (
                    <GlassPanel key={rf.name} className="p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className={cn('h-4 w-4 shrink-0', riskScoreColor(rf.score))} aria-hidden="true" />
                          <Text variant="bodySm" className="truncate capitalize">
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
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when charging history is missing */
                icon={<Shield className="h-8 w-8" />}
                message={t('battery.degradation.noRiskData', 'Risk data will appear once charging history is available.')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 5 · Guidance: Recommendations + Health factors ─ */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-3 sm:gap-4 2xl:grid-cols-2">
          {/* Recommendations */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('battery.degradation.recommendations', 'Recommendations')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={120} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
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
          </GlassPanel>

          {/* Battery health factors */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('battery.degradation.healthFactors', 'Battery Health Factors')}
            </PanelTitle>
            {healthQuery.isLoading ? (
              <Skeleton height={140} />
            ) : healthQuery.error ? (
              <QueryError error={healthQuery.error} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-3">
                {/* Charge habits */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('Charge Habits')}</Text>
                    <Badge variant={scoreVariant(data?.charge_habits_score ?? 0)} size="sm">
                      {fmtNumber(data?.charge_habits_score ?? 0)}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <Caption>{t('Fast Charge')}</Caption>
                      <Caption className="font-medium">{fmtNumber(data?.fast_charge_pct ?? 0)}%</Caption>
                    </div>
                    <div className="flex justify-between gap-2">
                      <Caption>{t('Full Charge')}</Caption>
                      <Caption className="font-medium">{fmtNumber(data?.full_charge_pct ?? 0)}%</Caption>
                    </div>
                  </div>
                </GlassPanel>

                {/* Temperature exposure */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('Temperature Exposure')}</Text>
                    <Badge variant={scoreVariant(data?.temp_exposure_score ?? 0)} size="sm">
                      {fmtNumber(data?.temp_exposure_score ?? 0)}/100
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                    <Caption>{t('Lower is better for longevity')}</Caption>
                  </div>
                </GlassPanel>

                {/* Cycle depth */}
                <GlassPanel className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Text variant="bodySm" className="font-medium">{t('Cycle Depth')}</Text>
                    <Badge variant={scoreVariant(cycleDepthScore)} size="sm">
                      {fmtNumber(cycleDepthScore)}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <Caption>{t('Avg DoD')}</Caption>
                      <Caption className="font-medium">
                        {fmtNumber(data?.avg_depth_of_discharge_pct ?? 0)}%
                      </Caption>
                    </div>
                  </div>
                </GlassPanel>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── 6 · Detail: Degradation history table ────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('battery.degradation.history', 'Degradation History')}
          </PanelTitle>
          {healthQuery.isLoading ? (
            <Skeleton height={240} />
          ) : healthQuery.error ? (
            <QueryError error={healthQuery.error} />
          ) : (data?.history?.length ?? 0) > 0 ? (
            <DataTable
              tableId="battery:degradation-history"
              columns={columns}
              data={data?.history ?? []}
              keyExtractor={(row: DegradationEntry) =>
                `${row.date}-${row.odometer_m}`
              }
              emptyMessage={t('No degradation records found.')}
              compact
              pagination
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when no snapshots exist yet */
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
