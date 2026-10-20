import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Snowflake, Sun, Lightbulb,
  BarChart3, CalendarRange, Car, TrendingUp,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Badge, Button, Caption, Text, HelperText, DataTable, type Column } from '@/components/ui';
import { MapsOperationalBrief } from '../components/operationalbrief-all/MapsOperationalBrief';
import { AlertBanner, Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import {
  ChartTooltip, CHART_COLORS, AREA_DEFAULTS,
  ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ChartLegend, ReferenceLine,
  ComposedChart, Bar, EmbeddedChart, type ChartDataColumn,
} from '@/components/charts';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { useChartPalette } from '@/hooks/useChartPalette';

import { convertTempFromSI, convertEfficiencyFromSI } from '@/lib/unitConversion';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { typography } from '@/lib/tokens';
import {
  useTemperatureImpact,
  type TemperatureImpactPoint,
} from '@/api/hooks/useAnalytics';
import { AICabinTemperatureImpactNarrative } from '@/components/ai';
import { EfficiencyDetectivePanel } from '../components/EfficiencyDetectivePanel';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ----------------------------------------------------------------*/
/*  Types */
/* ----------------------------------------------------------------*/

interface BucketDef {
  label: string;
  min: number;
  max: number;
  color: string;
}

interface BucketAvg {
  label: string;
  avg: number | null;
  avgWhM: number | null;
  count: number;
  color: string;
}

interface PopulatedBucketAvg extends BucketAvg {
  avg: number;
  avgWhM: number;
}

interface DriveRow extends TemperatureImpactPoint {
  id: number;
}

/* ----------------------------------------------------------------*/
/*  Constants */
/* ----------------------------------------------------------------*/

const TEMP_BUCKETS_C = [
  { min: -50, max: 0 },
  { min: 0, max: 10 },
  { min: 10, max: 20 },
  { min: 20, max: 30 },
  { min: 30, max: 60 },
] as const;

function isMeasurement(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getTempBucketIndex(temp: number): number {
  const idx = TEMP_BUCKETS_C.findIndex((b) => temp >= b.min && temp < b.max);
  if (idx >= 0) return idx;
  // Out-of-range readings (sensor spikes, absurd ambient values, or the exact
  // upper edge of the last bucket) clamp to the nearest edge bucket instead of
  // silently landing in the middle — otherwise an extreme-heat drive would be
  // miscounted as "moderate" and skew the best/worst analysis.
  return temp < TEMP_BUCKETS_C[0].min ? 0 : TEMP_BUCKETS_C.length - 1;
}

function bucketLabel(
  b: (typeof TEMP_BUCKETS_C)[number],
  toTemperatureDisplay: (c: number) => number,
  tempUnit: string,
  idx: number,
): string {
  if (idx === 0) return `< ${Math.round(toTemperatureDisplay(b.max))}${tempUnit}`;
  if (idx === TEMP_BUCKETS_C.length - 1) return `≥ ${Math.round(toTemperatureDisplay(b.min))}${tempUnit}`;
  return `${Math.round(toTemperatureDisplay(b.min))}–${Math.round(toTemperatureDisplay(b.max))}${tempUnit}`;
}

/* ----------------------------------------------------------------*/
/*  Component */
/* ----------------------------------------------------------------*/

export default function TemperatureImpactPage() {
  const { fmtNumber } = useNumberFormatting();
  const { formatDate } = useDateFormat();
  const { t } = useTranslation();
  usePageTitle(t('tempImpact.title', 'Temperature impact'));

  // Preserve the endpoint's derived Wh/km and km fields; only display values
  // are converted. Operational metrics consume canonical Wh/m.
  const { unitPrefs, formatTemperature, formatDistance } = useUnits();
  const chartColors = useChartPalette();
  const chartTick = { fill: 'var(--text-muted)', fontSize: getChartFontSize(), fontFamily: getChartFontFamily() };
  const tempUnit = unitPrefs.temperature;
  const isMiles = unitPrefs.distance === 'mi';
  const effLabel = isMiles ? t('tempImpact.whPerMi', 'Wh/mi') : t('tempImpact.whPerKm', 'Wh/km');

  const toTemperatureDisplay = useCallback(
    (c: number) => convertTempFromSI(c, tempUnit),
    [tempUnit],
  );

  /* Efficiency: API returns Wh/km — convert to Wh/mi if the user prefers miles. */
  const toDispEff = useCallback(
    (whKm: number): number => convertEfficiencyFromSI(whKm, unitPrefs.distance),
    [unitPrefs.distance],
  );

  /* Build display bucket labels. */
  const tempBuckets: BucketDef[] = useMemo(
    () => TEMP_BUCKETS_C.map((b, i) => ({
      label: bucketLabel(b, toTemperatureDisplay, tempUnit, i),
      min: b.min,
      max: b.max,
      color: chartColors[i % chartColors.length] ?? CHART_COLORS[i],
    })),
    [toTemperatureDisplay, tempUnit, chartColors],
  );

  /* --- vehicle scope --- */
  const { vehicleId: selectedId } = useSelectedVehicle();
  const vehicleId = selectedId != null ? String(selectedId) : '';
  const noVehicle = vehicleId === '';

  /* --- data --- */
  const query = useTemperatureImpact(vehicleId);
  const { data } = query;
  const points = useMemo<TemperatureImpactPoint[]>(() => data?.points ?? [], [data]);
  const monthlyTrend = useMemo(() => data?.monthly_trend ?? [], [data]);
  const source = deriveDataState(query, {
    provenance: 'historical',
    unavailable: Array.isArray(data?.points) && Array.isArray(data?.monthly_trend) &&
      points.length === 0 && monthlyTrend.length === 0,
    partial: !Array.isArray(data?.points) || !Array.isArray(data?.monthly_trend) ||
      (points.length === 0) !== (monthlyTrend.length === 0) ||
      points.some((p) => !isMeasurement(p.outside_temp) || !isMeasurement(p.efficiency_wh_km) || !isMeasurement(p.distance_km)) ||
      monthlyTrend.some((m) => !isMeasurement(m.avg_temp) || !Number.isSafeInteger(m.drive_count) || m.drive_count < 0),
  });
  const isLoading = query.isLoading && !source.hasData;

  /* --- derived stats (client-side buckets over the efficiency_wh_km points) --- */
  const stats = useMemo(() => {
    if (points.length === 0) return null;

    const efficiencies = points.map((p) => p.efficiency_wh_km).filter(isMeasurement);
    const avgEff = efficiencies.length
      ? efficiencies.reduce((s, value) => s + value, 0) / efficiencies.length
      : null;

    const bucketCounts = new Map<number, number[]>();
    for (const p of points) {
      if (!isMeasurement(p.outside_temp) || !isMeasurement(p.efficiency_wh_km)) continue;
      const idx = getTempBucketIndex(p.outside_temp);
      const arr = bucketCounts.get(idx) ?? [];
      arr.push(p.efficiency_wh_km);
      bucketCounts.set(idx, arr);
    }

    const bucketAvgs: BucketAvg[] = tempBuckets.map((b, i) => {
      const vals = bucketCounts.get(i) ?? [];
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      return { label: b.label, avg: avg == null ? null : toDispEff(avg), avgWhM: avg == null ? null : avg / 1000, count: vals.length, color: b.color };
    });

    const withData = bucketAvgs.filter((b): b is PopulatedBucketAvg => b.avg != null && b.avgWhM != null);
    const best = withData.reduce((a, b) => (b.avg < a.avg ? b : a), withData[0]);
    const worst = withData.reduce((a, b) => (b.avg > a.avg ? b : a), withData[0]);

    return { avgEff: avgEff == null ? null : toDispEff(avgEff), avgEffWhM: avgEff == null ? null : avgEff / 1000, bucketAvgs, best, worst, total: points.length };
  }, [points, tempBuckets, toDispEff]);

  const bestLabel = stats?.best?.label;

  /* --- scatter data with colour per point --- */
  const scatterData = useMemo(
    () =>
      points.filter((p) => isMeasurement(p.outside_temp) && isMeasurement(p.efficiency_wh_km)).map((p) => ({
        ...p,
        outside_temp: toTemperatureDisplay(p.outside_temp),
        efficiency_wh_km: toDispEff(p.efficiency_wh_km),
        fill: tempBuckets[getTempBucketIndex(p.outside_temp)].color,
      })),
    [points, toTemperatureDisplay, toDispEff, tempBuckets],
  );

  /* --- monthly seasonal trend: drive count (bars) + avg temp (line) --- */
  const monthlyData = useMemo(
    () =>
      monthlyTrend.map((m) => ({
        month: m.month ?? '—',
        drives: Number.isSafeInteger(m.drive_count) && m.drive_count >= 0 ? m.drive_count : null,
        temp: isMeasurement(m.avg_temp) ? toTemperatureDisplay(m.avg_temp) : null,
      })),
    [monthlyTrend, toTemperatureDisplay],
  );

  /* --- recent drives table rows --- */
  const driveRows = useMemo<DriveRow[]>(
    () => points.map((p, i) => ({ ...p, id: i })),
    [points],
  );

  const driveColumns = useMemo<Column<DriveRow>[]>(
    () => [
      {
        key: 'drive_date',
        header: t('tempImpact.driveDate', 'Date'),
        sortable: true,
        render: (row) => (
          <Text variant="body">
            {row.drive_date ? formatDate(row.drive_date) : '—'}
          </Text>
        ),
      },
      {
        key: 'outside_temp',
        align: 'right',
        header: t('tempImpact.temperature', 'Temperature'),
        sortable: true,
        render: (row) => (
          <Text size="sm" color="secondary" className="tabular-nums">
            {isMeasurement(row.outside_temp) ? formatTemperature(row.outside_temp) : '—'}
          </Text>
        ),
      },
      {
        key: 'efficiency_wh_km',
        align: 'right',
        header: t('tempImpact.efficiency', 'Efficiency'),
        sortable: true,
        render: (row) => (
          <Text as="span" size="sm" className="tabular-nums">
            {isMeasurement(row.efficiency_wh_km) ? `${fmtNumber(toDispEff(row.efficiency_wh_km))} ${effLabel}` : '—'}
          </Text>
        ),
      },
      {
        key: 'distance_km',
        align: 'right',
        header: t('tempImpact.distance', 'Distance'),
        sortable: true,
        render: (row) => (
          <Text size="sm" color="secondary" className="tabular-nums">
            {isMeasurement(row.distance_km) ? formatDistance(row.distance_km * 1000) : '—'}
          </Text>
        ),
      },
    ],
    [t, formatDate, formatTemperature, formatDistance, toDispEff, effLabel, fmtNumber],
  );

  const scatterColumns: ChartDataColumn[] = [
    { key: 'drive_date', label: t('tempImpact.driveDate', 'Date'), format: (value) => typeof value === 'string' && value ? formatDate(value) : '—' },
    { key: 'outside_temp', label: t('tempImpact.temperature', 'Temperature'), format: (value) => isMeasurement(value) ? formatTemperature(value) : '—' },
    { key: 'efficiency_wh_km', label: t('tempImpact.efficiency', 'Efficiency'), format: (value) => isMeasurement(value) ? `${fmtNumber(toDispEff(value))} ${effLabel}` : '—' },
    { key: 'distance_km', label: t('tempImpact.distance', 'Distance'), format: (value) => isMeasurement(value) ? formatDistance(value * 1000) : '—' },
  ];
  const bucketColumns: ChartDataColumn[] = [
    { key: 'label', label: t('tempImpact.temperature', 'Temperature') },
    { key: 'avg', label: t('tempImpact.avgEff', 'Avg efficiency'), format: (value) => isMeasurement(value) ? `${fmtNumber(value)} ${effLabel}` : '—' },
    { key: 'count', label: t('tempImpact.driveCount', 'Drives'), kind: 'count' },
  ];
  const monthlyColumns: ChartDataColumn[] = [
    { key: 'month', label: t('tempImpact.driveDate', 'Date') },
    { key: 'drives', label: t('tempImpact.driveCount', 'Drives'), kind: 'count' },
    { key: 'temp', label: t('tempImpact.avgTemp', 'Avg temp'), format: (value) => isMeasurement(value) ? `${fmtNumber(value)}${tempUnit}` : '—' },
  ];

  /* --- contextual tips --- */
  const tips = useMemo(() => {
    const items: { icon: React.ElementType; text: string; variant: 'info' | 'warning' | 'success' }[] = [];
    if (!stats) return items;
    if (stats.best) {
      items.push({
        icon: TrendingUp,
        text: t('tempImpact.tipOptimal', {
          range: stats.best.label,
          defaultValue: 'Best efficiency observed in the {{range}} range',
        }),
        variant: 'success',
      });
    }
    const cold = stats.bucketAvgs[0];
    if (cold && cold.count > 0) {
      items.push({
        icon: Snowflake,
        text: t('tempImpact.tipCold', 'Precondition your cabin in cold weather to reduce battery drain'),
        variant: 'info',
      });
    }
    const hot = stats.bucketAvgs[TEMP_BUCKETS_C.length - 1];
    if (hot && hot.count > 0) {
      items.push({
        icon: Sun,
        text: t('tempImpact.tipHot', 'Park in shade during hot weather to preserve battery efficiency'),
        variant: 'warning',
      });
    }
    return items;
  }, [stats, t]);

  /* Contextual empty copy: prompt for a vehicle when none is scoped. */
  const emptyMessage = noVehicle
    ? t('tempImpact.selectVehicle', 'Select a vehicle to view temperature impact')
    : t('tempImpact.noData', 'No drive data available yet');

  /* Shared loading/error fallback for a data section. Returns `null` when the
     section is ready to render its own content, so every panel owns its
     loading + error + empty states independently. */
  const sectionFallback = useCallback(
    (isEmpty: boolean, opts: { skeletonHeight: number; icon: ReactNode }): ReactNode | null => {
      if (isLoading) return <Skeleton height={opts.skeletonHeight} />;
      // Only surface the error panel when there is no retained data to fall
      // back on. TanStack Query keeps the last successful `data` across a
      // failed background refetch — in that case each section keeps rendering
      // its last-good content and the header freshness chip owns the degraded
      // signal, rather than collapsing the whole page into retry panels.
      if (source.fatalError) return <QueryError error={source.fatalError} onRetry={() => query.refetch()} />;
      if (!noVehicle && source.status === 'initial' && source.isRefreshBlocked) {
        return (
          <AlertBanner variant="info" title={t('dataSources.status.paused', 'Refresh paused')}
            role="status" aria-live="polite" data-refresh-blocked>
            <div className="space-y-3">
              <Text variant="bodySm" color="secondary">
                {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
              </Text>
              <Button type="button" variant="secondary" size="sm" wrapLabel
                className="min-h-11 md:min-h-9" onClick={() => query.refetch()} disabled={query.isFetching}>
                {t('error.retry', 'Retry')}
              </Button>
            </div>
          </AlertBanner>
        );
      }
      if (isEmpty) {
        return (
          <EmptyState
            icon={opts.icon}
            message={emptyMessage}
            actionTo={
              noVehicle
                ? { label: t('tempImpact.manageVehicles', 'Manage vehicles'), to: '/vehicles' }
                : undefined
            }
            className="py-10"
          />
        );
      }
      return null;
    },
    [isLoading, source.fatalError, source.status, source.isRefreshBlocked, query, emptyMessage, noVehicle, t],
  );

  const hasPoints = points.length > 0;
  const hasMonthly = monthlyData.length > 0;
  const briefScope = t('tempImpact.brief.scope', 'Selected vehicle · returned drive points; source window unspecified. Monthly trend and efficiency detective use independent periods.');
  const briefMetrics = [
    { metricId: 'efficiency', occurrenceId: 'temperature-average', rawValue: stats?.avgEffWhM, label: t('tempImpact.avgEfficiency', 'Avg efficiency'), description: briefScope, display: { formatter: (raw: number) => ({ value: fmtNumber(toDispEff(raw * 1000)), unit: effLabel }) } },
    { metricId: 'text', occurrenceId: 'temperature-best', rawValue: stats?.best?.label, label: t('tempImpact.bestRange', 'Best temp range'), description: t('tempImpact.brief.best', 'Lowest average consumption among populated temperature buckets.'), context: stats?.best ? `${fmtNumber(stats.best.avg)} ${effLabel}` : undefined },
    { metricId: 'text', occurrenceId: 'temperature-worst', rawValue: stats?.worst?.label, label: t('tempImpact.worstRange', 'Worst temp range'), description: t('tempImpact.brief.worst', 'Highest average consumption among populated temperature buckets.'), context: stats?.worst ? `${fmtNumber(stats.worst.avg)} ${effLabel}` : undefined },
    { metricId: 'count', occurrenceId: 'temperature-points', rawValue: Array.isArray(data?.points) ? points.length : null, label: t('tempImpact.totalPoints', 'Total data points'), description: briefScope },
    { metricId: 'efficiency', occurrenceId: 'temperature-best-efficiency', rawValue: stats?.best?.avgWhM, label: t('tempImpact.brief.bestEfficiency', 'Best-range efficiency'), description: t('tempImpact.brief.best', 'Lowest average consumption among populated temperature buckets.'), display: { formatter: (raw: number) => ({ value: fmtNumber(toDispEff(raw * 1000)), unit: effLabel }) } },
    { metricId: 'efficiency', occurrenceId: 'temperature-worst-efficiency', rawValue: stats?.worst?.avgWhM, label: t('tempImpact.brief.worstEfficiency', 'Worst-range efficiency'), description: t('tempImpact.brief.worst', 'Highest average consumption among populated temperature buckets.'), display: { formatter: (raw: number) => ({ value: fmtNumber(toDispEff(raw * 1000)), unit: effLabel }) } },
  ] as const;

  /* ================================================================ */
  /*  Render */
  /* ================================================================ */

  return (
    <PageLayout
      title={t('tempImpact.title', 'Temperature impact')}
      subtitle={t('tempImpact.subtitle', 'How outside temperature affects driving efficiency')}
      query={query}
      dataSources={[{ id: 'temperature-impact', label: t('tempImpact.title', 'Temperature impact'), query, enabled: !noVehicle }]}
    >
      {/* AI cabin-temperature-impact narrator. Rendered ABOVE the deterministic
          charts so the narration contextualises the bucketed-efficiency chart
          and seasonal trend below. The withAiFeature HOC gates visibility — in
          ai_mode='off' this section is entirely absent from the DOM. */}
      <AICabinTemperatureImpactNarrative vehicleId={vehicleId !== '' ? vehicleId : undefined} />

      {/* ── KPI band ─────────────────────────────────────────── */}
      <FadeIn>
        <MapsOperationalBrief
          title={t('tempImpact.kpis', 'Summary metrics')}
          description={t('tempImpact.brief.description', 'Observed consumption and populated temperature buckets, with their original efficiency captions retained.')}
          scope={briefScope}
          metrics={briefMetrics}
          sources={[{ label: t('tempImpact.title', 'Temperature impact'), state: source }]}
          loading={isLoading}
        />
      </FadeIn>

      {/* ── Detective: month-over-month diagnosis ──────────── */}
      {!noVehicle && (
        <FadeIn delay={0.05}>
          <EfficiencyDetectivePanel vehicleId={vehicleId} />
        </FadeIn>
      )}

      {/* ── Row A: scatter hero + optimal analysis ───────────── */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('tempImpact.regionScatter', 'Temperature vs efficiency analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="min-w-0 xl:col-span-2">
          <LayoutCard title={t('tempImpact.scatterTitle', 'Temperature vs efficiency')}>
            {sectionFallback(scatterData.length === 0, {
              skeletonHeight: 288,
              icon: <Thermometer className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <>
                <div className="h-72 sm:h-80">
                  <EmbeddedChart
                    title={t('tempImpact.scatterTitle', 'Temperature vs efficiency')}
                    ariaLabel={t('tempImpact.scatterAria', 'Scatter plot of energy efficiency against outdoor temperature per drive')}
                    data={points.map((p) => ({ ...p }))}
                    dataColumns={scatterColumns}
                    fluid
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis
                          dataKey="outside_temp"
                          type="number"
                          name={`${t('tempImpact.temperature', 'Temperature')} (${tempUnit})`}
                          tick={chartTick}
                        />
                        <YAxis
                          dataKey="efficiency_wh_km"
                          type="number"
                          name={`${t('tempImpact.efficiency', 'Efficiency')} (${effLabel})`}
                          tick={chartTick}
                          width={44}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        {stats?.avgEff != null && (
                          <ReferenceLine
                            y={stats.avgEff}
                            stroke="var(--text-muted)"
                            strokeDasharray="4 4"
                            strokeOpacity={0.6}
                          />
                        )}
                        <Scatter data={scatterData} name={t('tempImpact.scatterName', 'Drives')}>
                          {scatterData.map((d, i) => (
                            <Cell key={i} fill={d.fill} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </EmbeddedChart>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {tempBuckets.map((b) => (
                    <div key={b.label} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: b.color }}
                        aria-hidden="true"
                      />
                      <Caption>{b.label}</Caption>
                    </div>
                  ))}
                </div>
              </>
            )}
          </LayoutCard>
          </div>

          <LayoutCard title={t('tempImpact.optimalTitle', 'Optimal temperature analysis')}>
            {sectionFallback(!stats?.best, {
              skeletonHeight: 220,
              icon: <Thermometer className="h-8 w-8" aria-hidden="true" />,
            }) ?? (stats?.best ? (
              <div className="space-y-3">
                <Text as="p" size="sm" color="secondary">
                  {t('tempImpact.optimalDesc', {
                    range: stats.best.label,
                    efficiency: fmtNumber(stats.best.avg),
                    unit: effLabel,
                    count: stats.best.count,
                    defaultValue:
                      stats.best.count === 1
                        ? 'Your most efficient temperature range is {{range}} with an average of {{efficiency}} {{unit}} across {{count}} drive.'
                        : 'Your most efficient temperature range is {{range}} with an average of {{efficiency}} {{unit}} across {{count}} drives.',
                  })}
                </Text>
                {stats.worst && stats.best.label !== stats.worst.label && (
                  <HelperText>
                    {t('tempImpact.optimalDelta', {
                      worst: stats.worst.label,
                      delta: fmtNumber(stats.worst.avg - stats.best.avg),
                      unit: effLabel,
                      defaultValue:
                        'Compared to the worst range ({{worst}}), you save {{delta}} {{unit}} on average.',
                    })}
                  </HelperText>
                )}
                <div className="flex flex-wrap gap-2">
                  {stats.bucketAvgs
                    .filter((b): b is PopulatedBucketAvg => b.avg != null && b.avgWhM != null)
                    .map((b) => (
                      <Badge
                        key={b.label}
                        variant={b.label === bestLabel ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {b.label}: {fmtNumber(b.avg)} {effLabel}
                      </Badge>
                    ))}
                </div>
              </div>
            ) : null)}
          </LayoutCard>
        </section>
      </FadeIn>

      {/* ── Row B: bucket line + monthly seasonal trend ──────── */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('tempImpact.regionTrends', 'Efficiency and seasonal trends')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <LayoutCard title={t('tempImpact.bucketTitle', 'Efficiency by temperature range')}>
            {sectionFallback(!stats?.best, {
              skeletonHeight: 240,
              icon: <BarChart3 className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <div className="h-56 sm:h-64">
                <EmbeddedChart
                  title={t('tempImpact.bucketTitle', 'Efficiency by temperature range')}
                  ariaLabel={t('tempImpact.bucketAria', 'Average efficiency line chart by temperature range bucket')}
                  data={stats?.bucketAvgs.map((b) => ({ ...b })) ?? []}
                  dataColumns={bucketColumns}
                  fluid
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={stats?.bucketAvgs ?? []}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="label" tick={chartTick} />
                      <YAxis tick={chartTick} width={44} />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend />
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="avg"
                        name={`${t('tempImpact.avgEff', 'Avg efficiency')} (${effLabel})`}
                        stroke={chartColors[0]}
                        strokeWidth={2}
                        connectNulls={false}
                        dot={{ r: 3, fill: chartColors[0] }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
              </div>
            )}
          </LayoutCard>

          <LayoutCard title={t('tempImpact.monthlyTitle', 'Monthly seasonal trend')}>
            {sectionFallback(!hasMonthly, {
              skeletonHeight: 240,
              icon: <CalendarRange className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <div className="h-56 sm:h-64">
                <EmbeddedChart
                  chartKey="temp-monthly-trend"
                  title={t('tempImpact.monthlyTitle', 'Monthly seasonal trend')}
                  ariaLabel={t('tempImpact.monthlyAria', 'Monthly drive count bars and average temperature line')}
                  data={monthlyData}
                  dataColumns={monthlyColumns}
                  fluid
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyData} margin={{ top: 10, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="month" tick={chartTick} />
                        <YAxis
                          yAxisId="left"
                          tick={chartTick}
                          allowDecimals={false}
                          width={36}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={chartTick}
                          width={40}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend />
                        <Bar
                          yAxisId="left"
                          dataKey="drives"
                          name={t('tempImpact.driveCount', 'Drives')}
                          fill={chartColors[0]}
                          fillOpacity={0.75}
                          radius={[4, 4, 0, 0]}
                          hide={hiddenSeries?.isHidden('drives') ?? false}
                        />
                        <Line
                          yAxisId="right"
                          {...AREA_DEFAULTS}
                          dataKey="temp"
                          name={`${t('tempImpact.avgTemp', 'Avg temp')} (${tempUnit})`}
                          stroke={chartColors[3] ?? chartColors[1]}
                          strokeWidth={2}
                          connectNulls={false}
                          dot={false}
                          hide={hiddenSeries?.isHidden('temp') ?? false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </EmbeddedChart>
              </div>
            )}
          </LayoutCard>
        </section>
      </FadeIn>

      {/* ── Row C: recommendations + recent drives ───────────── */}
      <FadeIn delay={0.3}>
        <section
          aria-label={t('tempImpact.regionRecs', 'Recommendations and recent drives')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <LayoutCard title={t('tempImpact.tipsTitle', 'Recommendations')}>
            {sectionFallback(tips.length === 0, {
              skeletonHeight: 180,
              icon: <Lightbulb className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <ul className="space-y-2">
                {tips.map((tip) => {
                  const Icon = tip.icon;
                  return (
                    <li key={tip.text} className="flex items-start gap-3">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${typography.color.muted}`} aria-hidden="true" />
                      <Text as="p" variant="bodySm" className="min-w-0 break-words">
                        {tip.text}
                      </Text>
                    </li>
                  );
                })}
              </ul>
            )}
          </LayoutCard>

          <div className="min-w-0 xl:col-span-2">
          <LayoutCard title={t('tempImpact.recentDrivesTitle', 'Recent drives')}>
            {sectionFallback(!hasPoints, {
              skeletonHeight: 260,
              icon: <Car className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <DataTable
                tableId="maps:temperature-impact-drives"
                columns={driveColumns}
                mobileColumns={['drive_date', 'outside_temp', 'efficiency_wh_km', 'distance_km']}
                data={driveRows}
                keyExtractor={(row) => row.id}
                emptyMessage={t('tempImpact.noData', 'No drive data available yet')}
                pagination
              />
            )}
          </LayoutCard>
          </div>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
