import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, AlertTriangle,
} from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard } from '@/components/layout';
import { BatteryDegradationStats, DegradationGrid } from '../components/battery-degradation-modernization';
import type { BatteryDegradationHealth } from '../components/battery-degradation-modernization/BatteryDegradationStats';
import { capacityEvidence, observationEvidence, driveDropEvidence, predictionIntervalEvidence, batteryNumber, batteryCount, batteryStress, healthMessageText } from '../components/battery-degradation-modernization/BatteryDegradationStats';

import {
  GlassPanel, Badge, DataTable, Text, Caption, HelpTooltip, type Column,
} from '@/components/ui';
import { MetricBar, FreshnessDotAuto } from '@/components/data-display';
import {
  LinearGauge, ChartLegend, ChartTooltip, EmbeddedChart, renderAnnotationLines,
  chartGrid, axisTickSm,
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
import { useRangeState } from '@/hooks/useRangeState';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDayKey } from '@/lib/dateFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';

import { cn } from '@/lib/cn';
import { gaugeTone, neonColorMap, typography, chartTokens } from '@/lib/tokens';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

/* ── Types ─────────────────────────────────────────────── */

type DegradationEntry = BatteryDegradationHealth['history'][number];

/* ── Helpers ───────────────────────────────────────────── */

function scoreVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

function validPercent(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function riskScoreColor(score: number): string {
  if (!Number.isFinite(score)) return typography.color.muted;
  if (score <= 25) return neonColorMap.green.text;
  if (score <= 50) return neonColorMap.amber.text;
  return neonColorMap.red.text;
}

function riskBarColor(score: number): string {
  if (!Number.isFinite(score)) return gaugeTone.neutral;
  if (score <= 25) return gaugeTone.success;
  if (score <= 50) return gaugeTone.warning;
  return gaugeTone.danger;
}

function riskBadgeVariant(score: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (!Number.isFinite(score)) return 'neutral';
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
  // Only known product values are translation keys; future server values retain their readable fallback.
  const stressLabels: Record<string, string> = {
    "Low": t("battery.degradation.stressValue.Low", "Low"),
    "Medium": t("battery.degradation.stressValue.Medium", "Medium"),
    "High": t("battery.degradation.stressValue.High", "High"),
  };
  const riskLabels: Record<string, string> = {
    "low": t("battery.degradation.riskLabel.low", "Low"),
    "moderate": t("battery.degradation.riskLabel.moderate", "Moderate"),
    "elevated": t("battery.degradation.riskLabel.elevated", "Elevated"),
    "high": t("battery.degradation.riskLabel.high", "High"),
    "unknown": t("battery.degradation.riskLabel.unknown", "Unknown"),
  };
  const riskNames: Record<string, string> = {
    "fast_charge_ratio": t("battery.degradation.risk.fast_charge_ratio", "fast charge ratio"),
    "high_soc_charging": t("battery.degradation.risk.high_soc_charging", "high soc charging"),
    "temperature_exposure": t("battery.degradation.risk.temperature_exposure", "temperature exposure"),
    "cycle_count_rate": t("battery.degradation.risk.cycle_count_rate", "cycle count rate"),
    "deep_discharge_frequency": t("battery.degradation.risk.deep_discharge_frequency", "deep discharge frequency"),
  };

  const { opts, formatDate: formatInstantDate, formatDateTime } = useDateFormat();
  const formatHistoryDate = useCallback(
    (key: string | null | undefined) => formatDayKey(key, opts),
    [opts],
  );
  const { formatMonthYear } = useDateLabels();
  const formatProjectionMonth = useCallback((key: string | null | undefined) => {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) return '—';
    return formatMonthYear(key);
  }, [formatMonthYear]);
  const formatChartDate = useCallback(
    (key: string | number | undefined) => typeof key !== 'string' ? '—'
      : /^\d{4}-\d{2}$/.test(key) ? formatProjectionMonth(key) : formatHistoryDate(key),
    [formatHistoryDate, formatProjectionMonth],
  );
  usePageTitle(t('battery.degradation.title', 'Battery degradation'));

  /* Vehicle selector: header picker is the source of truth. */
  const { vehicleId: activeId } = useSelectedVehicle();
  const activeIdStr = activeId != null ? String(activeId) : null;

  /* Battery health analytics (overview stats, range chart, history table). */
  const range = useRangeState();
  const healthQuery = useBatteryHealthAnalytics(activeIdStr, {
    start: range.startInstant,
    end: range.endInstantExclusive,
  });
  const healthState = useDataState(healthQuery, {
    provenance: 'inferred',
    maxAgeMs: 24 * 60 * 60 * 1000,
  });
  const { fatalError } = healthState;
  const data: BatteryDegradationHealth | undefined = healthState.data;
  const history = useMemo(() => (Array.isArray(data?.history) ? data.history : [])
    .filter(row => row != null && typeof row === 'object' && !Array.isArray(row))
    .map(row => ({
      ...row,
      date: typeof row.date === 'string' ? row.date : '',
      soh_pct: batteryNumber(row.soh_pct, 0, 100),
      capacity_wh: batteryNumber(row.capacity_wh, 0),
      range_m: batteryNumber(row.range_m, 0),
      odometer_m: batteryNumber(row.odometer_m, 0),
      range_sampled_at: typeof row.range_sampled_at === 'string' ? row.range_sampled_at : null,
      odometer_sampled_at: typeof row.odometer_sampled_at === 'string' ? row.odometer_sampled_at : null,
    })), [data]);
  const initialLoading = activeId != null && !healthState.hasData &&
    !fatalError && !healthState.isRefreshBlocked;
  const unavailableMessage = activeId == null
    ? t('common.noVehicleSelected.title', 'No vehicle selected')
    : !healthState.hasData && healthState.isRefreshBlocked
      ? t('battery.degradation.initialPaused', 'Battery analytics loading is paused. Reconnect to load this vehicle’s history.')
      : null;
  const unavailableDescription = activeId == null
    ? t('battery.degradation.selectVehicleHelp', 'Select a vehicle to view its battery history.')
    : t('battery.degradation.reconnectHelp', 'Reconnect to Tesla, then retry to load this vehicle\'s battery history.');

  /* URL-persisted hidden-series state lets users declutter and share
     the projection view. */
  const trendHidden = useHiddenSeries('battery-degradation-trend');
  const palette = useChartPalette();

  /* Capacity, range, and odometer values remain SI until this display boundary. */
  const { unitPrefs, formatEnergy, formatTemperature } = useUnits();
  const fromMeters = useCallback(
    (meters: number): number => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );

  /* Range-loss chart data */
  const rangeData = useMemo(() => {
    if (history.length === 0) return [];
    const retainedBaseline = history[0].range_m != null
      ? fromMeters(history[0].range_m) : null;
    return history.map((h) => ({
      date: h.date,
      original: retainedBaseline,
      current: h.range_m != null && Number.isFinite(h.range_m) ? fromMeters(h.range_m) : null,
      range_sampled_at: h.range_sampled_at ?? null,
      baseline_sampled_at: history[0].range_sampled_at ?? null,
    }));
  }, [history, fromMeters]);

  /* Projection chart: actual history + predicted future with approximate prediction band */
  const projectionChartData = useMemo(() => {
    const hist = history.map((h) => ({
      label: h.date,
      health: h.soh_pct,
      projected: undefined as number | undefined,
      confidence_low: undefined as number | undefined,
      confidence_high: undefined as number | undefined,
      confidence_band: undefined as number | undefined,
    }));
    const projections = data?.prediction?.fit_valid === true && data.prediction.has_enough_data
      ? Array.isArray(data.projections) ? data.projections : [] : [];
    const proj = projections.filter(p => p != null && typeof p === 'object' && !Array.isArray(p) &&
      typeof p.date === 'string').map((p) => ({
      label: p.date,
      health: undefined as number | undefined,
      projected: batteryNumber(p.health_pct, 0, 100),
      confidence_low: validPercent(p.confidence_low) && validPercent(p.confidence_high) &&
        p.confidence_low <= p.confidence_high ? p.confidence_low : undefined,
      confidence_high: validPercent(p.confidence_low) && validPercent(p.confidence_high) &&
        p.confidence_low <= p.confidence_high ? p.confidence_high : undefined,
      confidence_band: validPercent(p.confidence_low) && validPercent(p.confidence_high) &&
        p.confidence_low <= p.confidence_high ? p.confidence_high - p.confidence_low : undefined,
    }));
    return [...hist, ...proj];
  }, [data, history]);
  // Join geometry is not another observation and must not enter CSV/table rows.
  const projectionPlotData = useMemo(() => {
    const lastObservedIndex = history.length - 1;
    const firstForecast = projectionChartData[lastObservedIndex + 1];
    const lastObserved = projectionChartData[lastObservedIndex];
    return projectionChartData.map((point, index) => ({
      ...point,
      forecast_join: lastObserved && firstForecast?.projected != null
        ? index === lastObservedIndex ? lastObserved.health
          : index === lastObservedIndex + 1 ? firstForecast.projected : undefined
        : undefined,
    }));
  }, [history, projectionChartData]);
  const formatPercent = useCallback(
    (value: unknown) => typeof value === 'number' && Number.isFinite(value)
      ? `${fmtNumber(value)}%` : '—',
    [fmtNumber],
  );

  const habits = data?.charging_habits;
  const totalCharges = batteryCount(habits?.fast_charge_count) != null &&
    batteryCount(habits?.slow_charge_count) != null && habits
    ? habits.fast_charge_count + habits.slow_charge_count : null;
  const validChargeCount = batteryCount(data?.valid_charge_count);
  const fastChargePct = validChargeCount != null && validChargeCount > 0 && totalCharges != null && totalCharges > 0 && habits
    ? fmtInt((habits.fast_charge_count / totalCharges) * 100) : '—';

  const avgDoD = (batteryCount(data?.valid_dod_count) ?? 0) > 0 &&
    validPercent(data?.avg_depth_of_discharge_pct) ? data.avg_depth_of_discharge_pct : null;
  const cycleDepthScore = avgDoD != null
    ? 100 - avgDoD
    : null;
  const habitsScore = data?.charge_habits_available !== false &&
    validPercent(data?.charge_habits_score) ? data.charge_habits_score : null;
  const fastPct = totalCharges != null && totalCharges > 0 && validChargeCount != null && validChargeCount > 0 &&
    validPercent(data?.fast_charge_pct) ? data.fast_charge_pct : null;
  const fullPct = (batteryCount(data?.valid_end_soc_count) ?? 0) > 0 &&
    validPercent(data?.full_charge_pct) ? data.full_charge_pct : null;
  const thermalAvailable = data?.temp_exposure_available !== false &&
    (data?.temp_sample_count == null || (batteryCount(data.temp_sample_count) ?? 0) >= 10) &&
    data?.temp_exposure_reason == null;
  const tempScore = thermalAvailable && validPercent(data?.temp_exposure_score) ? data.temp_exposure_score : null;

  const riskFactors = (Array.isArray(data?.risk_factors) ? data.risk_factors : [])
    .filter(row => row != null && typeof row === 'object' && !Array.isArray(row) && typeof row.name === 'string' &&
      row.name.trim().length > 0);
  const recommendationMessages = Array.isArray(data?.recommendation_messages)
    ? data.recommendation_messages : null;
  const recommendations = recommendationMessages != null
    ? recommendationMessages
      .filter(row => row != null && typeof row === 'object' && typeof row.code === 'string' &&
        typeof row.fallback === 'string' && row.fallback.trim().length > 0)
      .map(row => healthMessageText(row, 'recommendation', t, fmtNumber, formatTemperature))
    : (Array.isArray(data?.recommendations) ? data.recommendations : [])
      .filter(row => typeof row === 'string' && row.trim().length > 0);
  const stressLevel = batteryStress(data);
  const soh = data?.current_soh_available === false ? null : batteryNumber(data?.current_soh, 0, 100);

  /* Table columns */
  const columns: Column<DegradationEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        filterValue: (row) => row.date ?? null,
        filterValueLabel: (_, row) => formatHistoryDate(row.date),
        header: t('battery.degradation.date', 'Date'),
        render: (row: DegradationEntry) => formatHistoryDate(row.date),
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
        filterValueLabel: (_, row) => row.capacity_wh != null ? formatEnergy(row.capacity_wh) : '—',
        header: t('battery.degradation.capacity', 'Capacity'),
        render: (row: DegradationEntry) =>
          row.capacity_wh != null ? formatEnergy(row.capacity_wh) : '—',
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
      {
        key: 'range_sampled_at',
        filterValueLabel: (_, row) => formatDateTime(row.range_sampled_at),
        header: t('battery.degradation.rangeSampledAt', 'Range sample timestamp'),
        render: row => formatDateTime(row.range_sampled_at),
        sortable: true,
      },
      {
        key: 'odometer_sampled_at',
        filterValueLabel: (_, row) => formatDateTime(row.odometer_sampled_at),
        header: t('battery.degradation.odometerSampledAt', 'Odometer sample timestamp'),
        render: row => formatDateTime(row.odometer_sampled_at),
        sortable: true,
      },
    ],
    [t, fromMeters, unitPrefs.distance, formatEnergy, fmtNumber, formatHistoryDate, formatDateTime],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageLayout
      title={t('battery.degradation.title', 'Battery degradation')}
      subtitle={t('battery.degradation.subtitle', 'Health trends, degradation predictions, and charging habit impact')}
      metadataActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Battery health analytics derive from a daily cagg; force amber after 24h. */}
          <FreshnessDotAuto query={healthQuery} forceStaleAfterMs={24 * 60 * 60 * 1000} />
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            </GlassPanel>
          ) : unavailableMessage ? (
            <EmptyState message={unavailableMessage} description={unavailableDescription}
              actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
              action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
          ) : (
            <BatteryDegradationStats data={data} loading={initialLoading} retained={healthState.status === 'stale'} range={range} />
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
                text={`${capacityEvidence(data, t)} ${observationEvidence(data, t, formatInstantDate)}`}
                className="min-h-11 min-w-11"
              />
            }
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
              {fatalError ? (
                <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
              ) : unavailableMessage ? (
                <EmptyState message={unavailableMessage} description={unavailableDescription}
                  actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                  action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
              ) : initialLoading ? (
                <Skeleton height={200} />
              ) : soh != null && Number.isFinite(soh) ? (
                <>
                  <LinearGauge
                    value={soh}
                    max={100}
                    label={t('battery.degradation.currentSoh', 'Current SOH')}
                    unit="%"
                    tone={soh > 90 ? 'success' : soh >= 80 ? 'warning' : 'danger'}
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
            <ChartCard
              toolbar exportable size="standard"
              title={t('battery.degradation.trendTitle', 'Health trend & projection')}
              ariaLabel={t('battery.degradation.predictionBandChartAria', 'Battery health trend and approximate prediction band chart')}
              subtitle={predictionIntervalEvidence(data, t)}
              height={300}
              chartKey="battery-degradation-trend"
              loading={initialLoading}
              error={fatalError}
              onRetry={healthState.retry ?? undefined}
              empty={projectionChartData.length === 0}
              emptyMessage={unavailableMessage ?? undefined}
              data={projectionChartData}
              exportData={projectionChartData}
              dataColumns={[
                { key: 'label', label: t('battery.degradation.date', 'Date') },
                { key: 'health', label: t('battery.degradation.actualHealth', 'Actual health %'), format: formatPercent },
                { key: 'projected', label: t('battery.degradation.projected', 'Projected %'), format: formatPercent },
                { key: 'confidence_low', label: t('costAnalysis.forecast.lowerBound', 'Lower bound'), format: formatPercent },
                { key: 'confidence_high', label: t('costAnalysis.forecast.upperBound', 'Upper bound'), format: formatPercent },
              ]}
              annotations={{ vehicleId: activeId, scope: 'battery', chartId: 'battery-degradation-trend' }}
            >
              {({ annotations: chartAnnotations }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={projectionPlotData}>
                    {chartGrid}
                    <defs>
                      <linearGradient id="ciBand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={palette[4]} stopOpacity={0.08} />
                        <stop offset="100%" stopColor={palette[4]} stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tickFormatter={formatChartDate} tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis domain={[60, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip content={<ChartTooltip labelFormatter={formatChartDate} />} />
                    <ChartLegend state={trendHidden} />
                    <ReferenceLine
                      y={80}
                      stroke={chartTokens.axisStroke}
                      strokeWidth={1}
                      strokeDasharray="6 4"
                      label={{ value: t('battery.degradation.warranty', "80% Warranty"), fill: chartTokens.axisStroke, position: 'insideTopRight' }}
                    />
                    <ReferenceLine y={70} stroke={chartTokens.axisStroke} strokeWidth={1} strokeDasharray="6 4" />
                    {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                    {/* Prediction band (stacked areas: transparent base + visible band) */}
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
                      fillOpacity={1}
                      name={t('battery.degradation.approximatePredictionBand', 'Approximate prediction band')}
                      connectNulls={false}
                      hide={trendHidden.isHidden('confidence_band')}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="health"
                      name={t('battery.degradation.actualHealth', 'Actual health %')}
                      stroke={palette[1]}
                      strokeWidth={2}
                      dot={{ fill: palette[1], r: 3 }}
                      connectNulls={false}
                      hide={trendHidden.isHidden('health')}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="forecast_join"
                      stroke={palette[4]}
                      strokeWidth={2}
                      strokeDasharray="8 4"
                      dot={false}
                      activeDot={false}
                      tooltipType="none"
                      legendType="none"
                      connectNulls={false}
                      hide={trendHidden.isHidden('projected')}
                    />
                    <Line
                      {...AREA_DEFAULTS}
                      dataKey="projected"
                      name={t('battery.degradation.projected', 'Projected %')}
                      stroke={palette[4]}
                      strokeWidth={2}
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : data?.prediction?.fit_valid === true && data.prediction.has_enough_data &&
              data.prediction.slope_per_year != null && Number.isFinite(data.prediction.slope_per_year) ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                  <Text as="p" variant="bodySm">
                    {data.prediction.crossing_status === 'future_crossing' &&
                      data.prediction.years_to_80_pct != null && Number.isFinite(data.prediction.years_to_80_pct) &&
                      data.prediction.years_to_80_pct > 0 ? <>
                    {t('battery.degradation.predictionDesc', 'At current rate, battery reaches')}{' '}
                    <Text weight="semibold">80%</Text>{' '}
                    {t('battery.degradation.inApprox', 'in approximately')}{' '}
                    <Text weight="semibold">
                      {data.prediction.years_to_80_pct != null && Number.isFinite(data.prediction.years_to_80_pct)
                        ? `~${fmtNumber(data.prediction.years_to_80_pct)}` : '—'} {t('battery.degradation.years', 'years')}
                    </Text>
                    {data.prediction.predicted_date && (
                      <> ({formatProjectionMonth(data.prediction.predicted_date)})</>
                    )}
                    </> : data.prediction.crossing_status === 'below_threshold'
                      ? t('battery.degradation.belowThreshold', 'Fitted health is already at or below 80%.')
                      : data.prediction.crossing_status === 'no_future_crossing'
                        ? t('battery.degradation.noFutureCrossing', 'The fitted trend does not predict a future crossing of 80%.')
                        : t('battery.degradation.crossingUnavailable', 'The 80% crossing estimate is unavailable.')}
                  </Text>
                </div>
                <BatteryDegradationStats data={data} retained={healthState.status === 'stale'} prediction range={range} />
              </div>
            ) : (
              <EmptyState /* no-action: prediction needs a minimum snapshot count that isn't met yet */
                icon={<AlertTriangle className="h-8 w-8" />}
                message={t("battery.degradation.validFitRequired", 'Need a valid fit to generate prediction (minimum 3 valid snapshots with time variation required)')}
              />
            )}
          </LayoutCard>

          {/* Charging habits impact */}
          <LayoutCard title={t('battery.degradation.chargingImpact', 'Charging habits impact')} size="third">
            {initialLoading ? (
              <Skeleton height={120} />
            ) : fatalError ? (
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : habits ? (
              <AlertBanner
                variant={
                  stressLevel == null ? 'info' : stressLevel === 'Low' ? 'success' :
                  stressLevel === 'Medium' ? 'warning' : 'danger'
                }
                icon={<Thermometer className="h-5 w-5" aria-hidden="true" />}
                title={`${fastChargePct}% ${t('battery.degradation.fastCharges', 'fast charges')}, ${batteryCount(habits.deep_discharge_count) != null ? fmtInt(habits.deep_discharge_count) : '—'} ${t('battery.degradation.deepDischarges', 'deep discharges')} — ${stressLevel != null ? stressLabels[stressLevel] ?? stressLevel : '—'} ${t('battery.degradation.stressLabel', 'stress')}`}
              >
                {stressLevel == null
                  ? t('battery.degradation.noStress', 'Charging impact will appear once charging history is available.')
                  : stressLevel === 'Low'
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : rangeData.length > 0 ? (
              <>
              <Caption className="mb-3 block">
                {t('battery.degradation.retainedRangeEvidence',
                  'The comparison baseline is the range estimate attached to the first retained history row, not new-pack range. Missing baseline values remain unknown. Sample timestamps identify carried-forward telemetry; the history date is the capacity aggregation day.')}
              </Caption>
              <EmbeddedChart
                title={t('battery.degradation.rangeLoss', 'Range loss over time')}
                ariaLabel={t(
                  'battery.degradation.rangeLossAria',
                  'First retained comparison baseline and estimated driving range over time',
                )}
                data={rangeData}
                dataColumns={[
                  { key: 'date', label: t('battery.degradation.date', 'Date') },
                  {
                    key: 'original', label: t('battery.degradation.retainedRangeBaseline', 'First retained range estimate'),
                    format: (value) => typeof value === 'number' && Number.isFinite(value)
                      ? `${fmtNumber(value)} ${unitPrefs.distance}` : '—',
                  },
                  {
                    key: 'current', label: t('battery.degradation.currentRange', 'Current range'),
                    format: (value) => typeof value === 'number' && Number.isFinite(value)
                      ? `${fmtNumber(value)} ${unitPrefs.distance}` : '—',
                  },
                  { key: 'range_sampled_at', label: t('battery.degradation.rangeSampledAt', 'Range sample timestamp') },
                  { key: 'baseline_sampled_at', label: t('battery.degradation.baselineSampledAt', 'Baseline sample timestamp') },
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
                    <XAxis dataKey="date" tickFormatter={formatHistoryDate} tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit={` ${unitPrefs.distance}`} />
                    <Tooltip content={<ChartTooltip labelFormatter={formatChartDate} valueFormatter={(value) =>
                      typeof value === 'number' ? `${fmtNumber(value)} ${unitPrefs.distance}` : '—'
                    } />} />
                    <ChartLegend />
                    {areaGradient('origRange', palette[0], 0.08)}
                    {areaGradient('curRange', palette[2], 0.08)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="original"
                      name={t('battery.degradation.retainedRangeBaseline', 'First retained range estimate')}
                      stroke={palette[0]}
                      strokeWidth={2}
                      fill="url(#origRange)"
                      fillOpacity={1}
                      connectNulls={false}
                      hide={hiddenSeries?.isHidden('original')}
                    />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="current"
                      name={t('battery.degradation.currentRange', 'Current range')}
                      stroke={palette[2]}
                      strokeWidth={2}
                      fill="url(#curRange)"
                      fillOpacity={1}
                      connectNulls={false}
                      hide={hiddenSeries?.isHidden('current')}
                    />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </EmbeddedChart>
              </>
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : riskFactors.length > 0 ? (
              <DegradationGrid
                label={t('battery.degradation.riskFactors', 'Risk factors')}
                sizes={riskFactors.map(() => 'half')}
              >
                {riskFactors.map((rf) => {
                  const Icon = riskFactorIcon(rf.name);
                  const score = rf.available !== false &&
                    (rf.name !== 'temperature_exposure' || thermalAvailable) &&
                    validPercent(rf.score) ? rf.score : NaN;
                  return (
                    <GlassPanel variant="embedded" key={rf.name} className="p-4 shadow-none">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 max-w-full items-center gap-2">
                          <Icon className={cn('h-4 w-4 shrink-0', riskScoreColor(score))} aria-hidden="true" />
                          <Text variant="bodySm" className="break-words">
                            {riskNames[rf.name] ?? rf.name.replace(/_/g, ' ')}
                          </Text>
                        </div>
                        <Badge variant={riskBadgeVariant(score)} size="sm">
                          {Number.isFinite(score) && typeof rf.label === 'string'
                            ? riskLabels[rf.label_code ?? rf.label.toLowerCase()] ?? rf.label : '—'}
                        </Badge>
                      </div>
                      <MetricBar
                        label={t('battery.degradation.riskScore', 'Risk score')}
                        value={Number.isFinite(score) ? score : null}
                        max={100}
                        color={riskBarColor(score)}
                        fill="solid"
                        sublabel={`${Number.isFinite(score) ? score : '—'}/100`}
                      />
                      <Caption className="mt-2 block">{Number.isFinite(score) && typeof rf.detail === 'string'
                        ? healthMessageText({
                          code: rf.detail_code ?? '', fallback: rf.detail, operands: rf.operands,
                        }, 'riskDetail', t, fmtNumber, formatTemperature) : '—'}</Caption>
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : recommendations.length > 0 ? (
              <ul className="space-y-3">
                {recommendations.map((rec, i) => (
                  <li key={i} className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                    <Zap className={cn('mt-0.5 h-4 w-4 shrink-0', typography.color.secondary)} aria-hidden="true" />
                    <Text as="p" variant="body" className="min-w-0 break-words">{rec}</Text>
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
              <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
            ) : unavailableMessage ? (
              <EmptyState message={unavailableMessage} description={unavailableDescription}
                actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
                action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
            ) : (
              <DegradationGrid
                label={t('battery.degradation.healthFactors', 'Battery health factors')}
                sizes={['third', 'third', 'third']}
              >
                {/* Charge habits */}
                <GlassPanel variant="embedded" className="p-4 shadow-none">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{t('battery.degradation.chargeHabits', 'Charge habits')}</Text>
                    <Badge variant={habitsScore != null ? scoreVariant(habitsScore) : 'neutral'} size="sm">
                      {habitsScore != null ? fmtNumber(habitsScore) : '—'}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <Caption>{t('battery.degradation.fastCharge', 'Fast charge')}</Caption>
                      <Caption className={typography.weight.medium}>{fastPct != null ? fmtNumber(fastPct) : '—'}%</Caption>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <Caption>{t('battery.degradation.fullCharge', 'Full charge')}</Caption>
                      <Caption className={typography.weight.medium}>{fullPct != null ? fmtNumber(fullPct) : '—'}%</Caption>
                    </div>
                  </div>
                </GlassPanel>

                {/* Temperature exposure */}
                <GlassPanel variant="embedded" className="p-4 shadow-none">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{t('battery.degradation.tempExposure', 'Temperature exposure')}</Text>
                    <Badge variant={tempScore != null ? riskBadgeVariant(tempScore) : 'neutral'} size="sm">
                      {tempScore != null ? fmtNumber(tempScore) : '—'}/100
                    </Badge>
                  </div>
                  {typeof data?.temp_exposure_reason === 'string' && (
                    <Caption className="mt-2 block break-words">{data.temp_exposure_reason}</Caption>
                  )}
                  <div className="flex items-center gap-2">
                    <Thermometer className={cn('h-3 w-3 shrink-0', typography.color.muted)} aria-hidden="true" />
                    <Caption>{t('battery.degradation.lowerBetter', 'Lower is better for longevity')}</Caption>
                  </div>
                </GlassPanel>

                {/* Cycle depth */}
                <GlassPanel variant="embedded" className="p-4 shadow-none">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{t('battery.degradation.cycleDepth', 'Cycle depth')}</Text>
                    <Badge variant={cycleDepthScore != null ? scoreVariant(cycleDepthScore) : 'neutral'} size="sm">
                      {cycleDepthScore != null ? fmtNumber(cycleDepthScore) : '—'}/100
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap justify-between gap-2">
                      <Caption>{t('battery.degradation.avgDoDLabel', 'Avg DoD')}</Caption>
                      <Caption className={typography.weight.medium}>
                        {avgDoD != null ? fmtNumber(avgDoD) : '—'}%
                      </Caption>
                    </div>
                  </div>
                  <Caption className="mt-2 block">{driveDropEvidence(data, t)}</Caption>
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
            <QueryError error={fatalError} onRetry={healthState.retry ?? undefined} />
          ) : unavailableMessage ? (
            <EmptyState message={unavailableMessage} description={unavailableDescription}
              actionTo={activeId == null ? { label: t('yearReview.goToVehicles', 'Go to vehicles'), to: '/vehicles' } : undefined}
              action={activeId != null ? { label: t('common.retry', 'Retry'), onClick: () => { void healthState.retry?.(); } } : undefined} />
          ) : history.length > 0 ? (
            <DataTable
              enableValueFilters
              name={t('battery.degradation.history', 'Degradation history')}
              rowLabel={(row: DegradationEntry) => formatHistoryDate(row.date)}
              tableId="battery:degradation-history"
              columns={columns}
              mobileColumns={['date', 'soh_pct']}
              mobilePresentation={{
                variant: 'cards',
                roles: {
                  date: 'title', soh_pct: 'primary', odometer_m: 'meta',
                  capacity_wh: 'meta', range_m: 'meta',
                  range_sampled_at: 'meta', odometer_sampled_at: 'meta',
                },
                displayValue: (row, key) => {
                  switch (key) {
                    case 'date': return formatHistoryDate(row.date);
                    case 'soh_pct': return row.soh_pct != null ? `${fmtNumber(row.soh_pct)}%` : '—';
                    case 'odometer_m': return row.odometer_m != null ? `${fmtNumber(fromMeters(row.odometer_m))} ${unitPrefs.distance}` : '—';
                    case 'capacity_wh': return row.capacity_wh != null ? formatEnergy(row.capacity_wh) : '—';
                    case 'range_m': return row.range_m != null ? `${fmtNumber(fromMeters(row.range_m))} ${unitPrefs.distance}` : '—';
                    case 'range_sampled_at': return formatDateTime(row.range_sampled_at);
                    case 'odometer_sampled_at': return formatDateTime(row.odometer_sampled_at);
                    default: return null;
                  }
                },
              }}
              data={history}
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
