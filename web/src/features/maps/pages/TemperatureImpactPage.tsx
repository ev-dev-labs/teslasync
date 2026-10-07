import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Snowflake, Sun, Lightbulb,
  BarChart3, CalendarRange, Car,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Badge, Caption, Text, HelperText, DataTable, type Column } from '@/components/ui';
import { MapsOperationalBrief } from '../components/operationalbrief-all/MapsOperationalBrief';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import {
  ChartTooltip, CHART_COLORS, AREA_DEFAULTS,
  ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ChartLegend, ReferenceLine,
  ComposedChart, Bar, EmbeddedChart,
} from '@/components/charts';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';

import { convertTempFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';
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
  avg: number;
  avgWhM: number;
  count: number;
  color: string;
}

interface DriveRow extends TemperatureImpactPoint {
  id: number;
}

/* ----------------------------------------------------------------*/
/*  Constants */
/* ----------------------------------------------------------------*/

/* Wh/km -> Wh/mi and km -> mi conversion factor. No efficiency helper
   exists in lib/unitConversion.ts, so we keep the km-per-mile factor here.
   Temperature and distance still round-trip through the SI-floor helpers. */
const KM_PER_MILE = 1.609344;

const TEMP_BUCKETS_C = [
  { min: -50, max: 0, color: '#3b82f6' },
  { min: 0, max: 10, color: '#06b6d4' },
  { min: 10, max: 20, color: '#10b981' },
  { min: 20, max: 30, color: '#f59e0b' },
  { min: 30, max: 60, color: '#ef4444' },
] as const;

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
  if (idx === TEMP_BUCKETS_C.length - 1) return `> ${Math.round(toTemperatureDisplay(b.min))}${tempUnit}`;
  return `${Math.round(toTemperatureDisplay(b.min))}–${Math.round(toTemperatureDisplay(b.max))}${tempUnit}`;
}

/* ----------------------------------------------------------------*/
/*  Component */
/* ----------------------------------------------------------------*/

export default function TemperatureImpactPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('tempImpact.title', 'Temperature impact'));

  /* --- unit conversion (SI display) ---
     Backend `/analytics/temperature-impact` emits SI: outside_temp °C,
     efficiency_wh_km Wh/km, distance_km km, avg_temp °C. We convert at the
     render boundary via useUnits()/convertTempFromSI and the inline
     KM_PER_MILE factor (no efficiency formatter exists yet). */
  const { unitPrefs, formatTemperature, formatDistance } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const isMiles = unitPrefs.distance === 'mi';
  const effLabel = isMiles ? t('tempImpact.whPerMi', 'Wh/mi') : t('tempImpact.whPerKm', 'Wh/km');

  const toTemperatureDisplay = useCallback(
    (c: number) => convertTempFromSI(c, tempUnit),
    [tempUnit],
  );

  /* Efficiency: API returns Wh/km — convert to Wh/mi if the user prefers miles. */
  const toDispEff = useCallback(
    (whKm: number): number => (isMiles ? whKm * KM_PER_MILE : whKm),
    [isMiles],
  );

  /* Build display bucket labels. */
  const tempBuckets: BucketDef[] = useMemo(
    () => TEMP_BUCKETS_C.map((b, i) => ({
      label: bucketLabel(b, toTemperatureDisplay, tempUnit, i),
      min: b.min,
      max: b.max,
      color: b.color,
    })),
    [toTemperatureDisplay, tempUnit],
  );

  /* --- vehicle scope --- */
  const { vehicleId: selectedId } = useSelectedVehicle();
  const vehicleId = selectedId != null ? String(selectedId) : '';
  const noVehicle = vehicleId === '';

  /* --- data --- */
  const query = useTemperatureImpact(vehicleId);
  const { data } = query;
  const source = deriveDataState(query, { provenance: 'historical' });
  const isLoading = query.isLoading && !source.hasData;
  const points = useMemo<TemperatureImpactPoint[]>(() => data?.points ?? [], [data]);
  const monthlyTrend = useMemo(() => data?.monthly_trend ?? [], [data]);

  /* --- derived stats (client-side buckets over the efficiency_wh_km points) --- */
  const stats = useMemo(() => {
    if (points.length === 0) return null;

    const avgEff =
      points.reduce((s, p) => s + (p.efficiency_wh_km ?? 0), 0) / points.length;

    const bucketCounts = new Map<number, number[]>();
    for (const p of points) {
      const idx = getTempBucketIndex(p.outside_temp ?? 0);
      const arr = bucketCounts.get(idx) ?? [];
      arr.push(p.efficiency_wh_km ?? 0);
      bucketCounts.set(idx, arr);
    }

    const bucketAvgs: BucketAvg[] = tempBuckets.map((b, i) => {
      const vals = bucketCounts.get(i) ?? [];
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      return { label: b.label, avg: toDispEff(avg), avgWhM: avg / 1000, count: vals.length, color: b.color };
    });

    const withData = bucketAvgs.filter((b) => b.count > 0);
    const best = withData.reduce((a, b) => (b.avg < a.avg ? b : a), withData[0]);
    const worst = withData.reduce((a, b) => (b.avg > a.avg ? b : a), withData[0]);

    return { avgEff: toDispEff(avgEff), avgEffWhM: avgEff / 1000, bucketAvgs, best, worst, total: points.length };
  }, [points, tempBuckets, toDispEff]);

  const bestLabel = stats?.best?.label;

  /* --- scatter data with colour per point --- */
  const scatterData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        outside_temp: toTemperatureDisplay(p.outside_temp ?? 0),
        efficiency_wh_km: toDispEff(p.efficiency_wh_km ?? 0),
        fill: TEMP_BUCKETS_C[getTempBucketIndex(p.outside_temp ?? 0)].color,
      })),
    [points, toTemperatureDisplay, toDispEff],
  );

  /* --- monthly seasonal trend: drive count (bars) + avg temp (line) --- */
  const monthlyData = useMemo(
    () =>
      monthlyTrend.map((m) => ({
        month: m.month ?? '—',
        drives: m.drive_count ?? 0,
        temp: Math.round(toTemperatureDisplay(m.avg_temp ?? 0) * 10) / 10,
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
            {formatTemperature(row.outside_temp)}
          </Text>
        ),
      },
      {
        key: 'efficiency_wh_km',
        align: 'right',
        header: t('tempImpact.efficiency', 'Efficiency'),
        sortable: true,
        render: (row) => (
          <Text as="span" size="sm" className="tabular-nums text-cyan-300">
            {fmtNumber(toDispEff(row.efficiency_wh_km ?? 0))} {effLabel}
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
            {formatDistance((row.distance_km ?? 0) * 1000)}
          </Text>
        ),
      },
    ],
    [t, formatTemperature, formatDistance, toDispEff, effLabel, fmtNumber],
  );

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
    [isLoading, source.fatalError, query, emptyMessage, noVehicle, t],
  );

  const hasPoints = points.length > 0;
  const hasMonthly = monthlyData.length > 0;
  const briefScope = t('tempImpact.brief.scope', 'Selected vehicle · returned drive points; source window unspecified. Monthly trend and efficiency detective use independent periods.');
  const briefMetrics = [
    { metricId: 'efficiency', occurrenceId: 'temperature-average', rawValue: stats?.avgEffWhM, label: t('tempImpact.avgEfficiency', 'Avg efficiency'), description: briefScope, display: { formatter: (raw: number) => ({ value: fmtNumber(toDispEff(raw * 1000)), unit: effLabel }) } },
    { metricId: 'text', occurrenceId: 'temperature-best', rawValue: stats?.best?.label, label: t('tempImpact.bestRange', 'Best temp range'), description: t('tempImpact.brief.best', 'Lowest average consumption among populated temperature buckets.'), context: stats?.best ? `${fmtNumber(stats.best.avg)} ${effLabel}` : undefined },
    { metricId: 'text', occurrenceId: 'temperature-worst', rawValue: stats?.worst?.label, label: t('tempImpact.worstRange', 'Worst temp range'), description: t('tempImpact.brief.worst', 'Highest average consumption among populated temperature buckets.'), context: stats?.worst ? `${fmtNumber(stats.worst.avg)} ${effLabel}` : undefined },
    { metricId: 'count', occurrenceId: 'temperature-points', rawValue: stats?.total ?? (source.hasData ? 0 : null), label: t('tempImpact.totalPoints', 'Total data points'), description: briefScope },
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
            {sectionFallback(!hasPoints, {
              skeletonHeight: 288,
              icon: <Thermometer className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <>
                {/* chart-a11y:no-table per-drive scatter cloud — each point is one drive, not meaningful as a table */}
                <div className="h-72 sm:h-80">
                  <EmbeddedChart
                    title={t('tempImpact.scatterTitle', 'Temperature vs efficiency')}
                    ariaLabel={t('tempImpact.scatterAria', 'Scatter plot of energy efficiency against outdoor temperature per drive')}
                    fluid
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis
                          dataKey="outside_temp"
                          type="number"
                          name={`${t('tempImpact.temperature', 'Temperature')} (${tempUnit})`}
                          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                        />
                        <YAxis
                          dataKey="efficiency_wh_km"
                          type="number"
                          name={`${t('tempImpact.efficiency', 'Efficiency')} (${effLabel})`}
                          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                          width={44}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        {stats && (
                          <ReferenceLine
                            y={stats.avgEff}
                            stroke={CHART_COLORS[1]}
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
                      'Your most efficient temperature range is {{range}} with an average of {{efficiency}} {{unit}} across {{count}} drives.',
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
                    .filter((b) => b.count > 0)
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
            {sectionFallback(!hasPoints, {
              skeletonHeight: 240,
              icon: <BarChart3 className="h-8 w-8" aria-hidden="true" />,
            }) ?? (
              <div className="h-56 sm:h-64">
                {/* chart-a11y:no-table efficiency-by-temp buckets — aggregate metric per range, not row-oriented */}
                <EmbeddedChart
                  title={t('tempImpact.bucketTitle', 'Efficiency by temperature range')}
                  ariaLabel={t('tempImpact.bucketAria', 'Average efficiency line chart by temperature range bucket')}
                  fluid
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={stats?.bucketAvgs ?? []}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={44} />
                      <Tooltip content={<ChartTooltip />} />
                      <ChartLegend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="avg"
                        name={`${t('tempImpact.avgEff', 'Avg efficiency')} (${effLabel})`}
                        stroke={CHART_COLORS[0]}
                        dot={{ r: 5, fill: CHART_COLORS[0] }}
                        activeDot={{ r: 7 }}
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
                {/* chart-a11y:no-table dual-axis monthly composite (bars + line) — dual-scale not representable as single table */}
                <EmbeddedChart
                  chartKey="temp-monthly-trend"
                  title={t('tempImpact.monthlyTitle', 'Monthly seasonal trend')}
                  ariaLabel={t('tempImpact.monthlyAria', 'Monthly drive count bars and average temperature line')}
                  fluid
                >
                  {({ hiddenSeries }) => (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyData} margin={{ top: 10, right: 8, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <YAxis
                          yAxisId="left"
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          allowDecimals={false}
                          width={36}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                          width={40}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          yAxisId="left"
                          dataKey="drives"
                          name={t('tempImpact.driveCount', 'Drives')}
                          fill={CHART_COLORS[0]}
                          fillOpacity={0.75}
                          radius={[4, 4, 0, 0]}
                          hide={hiddenSeries?.isHidden('drives') ?? false}
                        />
                        <Line
                          yAxisId="right"
                          {...AREA_DEFAULTS}
                          dataKey="temp"
                          name={`${t('tempImpact.avgTemp', 'Avg temp')} (${tempUnit})`}
                          stroke={CHART_COLORS[3] ?? CHART_COLORS[1]}
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
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                      <Badge variant={tip.variant} size="sm" dot>
                        {tip.text}
                      </Badge>
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
                mobileColumns={['drive_date', 'outside_temp', 'efficiency_wh_km']}
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
