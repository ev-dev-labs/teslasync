import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Snowflake, Sun, Lightbulb, TrendingUp, Activity, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import {
  ChartTooltip, CHART_COLORS, AREA_DEFAULTS,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, ReferenceLine,
} from '@/components/charts';

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertTempFromSI } from '@/lib/unitConversion';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TempEfficiencyPoint {
  outside_temp: number;
  efficiency_wh_km: number;
  distance_km: number;
  drive_date: string;
}

interface BucketDef {
  label: string;
  min: number;
  max: number;
  color: string;
}

interface BucketAvg {
  label: string;
  avg: number;
  count: number;
  color: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/* Wh/km -> Wh/mi conversion factor.
   Per Phase-43/0025 precedent (no convertEfficiencyFromSI helper exists in
   lib/unitConversion.ts), we keep the inline km-per-mile factor here. */
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
  return idx >= 0 ? idx : 2;
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemperatureImpactPage() {
  const { t } = useTranslation();
  usePageTitle(t('temperature.title', 'Temperature Impact'));

  /* ---- unit conversion (Phase-43 SI-floor display) ----
     Backend `/analytics/temperature-impact` emits points with:
       outside_temp:      °C SI (from ambient_temp_c_avg)
       efficiency_wh_km:  Wh/km (already derived in SQL)
       distance_km:       km (already derived in SQL)
     We convert outside_temp via convertTempFromSI (mathematically
     identical to legacy toTemperatureDisplay) and Wh/km -> Wh/mi inline using
     KM_PER_MILE per Phase-43/0025 (no convertEfficiencyFromSI helper). */
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  const isMiles = unitPrefs.distance === 'mi';
  const effLabel = isMiles ? 'Wh/mi' : 'Wh/km';

  const toTemperatureDisplay = useCallback(
    (c: number) => convertTempFromSI(c, tempUnit),
    [tempUnit],
  );

  /* Efficiency: API returns Wh/km — convert to Wh/mi if user prefers miles */
  const toDispEff = useCallback(
    (whKm: number): number => isMiles ? whKm * KM_PER_MILE : whKm,
    [isMiles],
  );

  /* Build display bucket labels */
  const tempBuckets: BucketDef[] = useMemo(
    () => TEMP_BUCKETS_C.map((b, i) => ({
      label: bucketLabel(b, toTemperatureDisplay, tempUnit, i),
      min: b.min,
      max: b.max,
      color: b.color,
    })),
    [toTemperatureDisplay, tempUnit],
  );

  /* ---- vehicles ---- */
  const { vehicleId: selectedId } = useSelectedVehicle();
  const vehicleId = selectedId != null ? String(selectedId) : '';

  /* ---- temperature data ---- */
  const { data: points, isLoading, error: dataError } = useQuery({
    queryKey: ['temperature-impact', vehicleId],
    queryFn: async () => {
      const res = await request<{ points: TempEfficiencyPoint[] }>(
        `/analytics/temperature-impact?vehicle_id=${vehicleId}`,
      );
      return res.points ?? [];
    },
    enabled: vehicleId !== '',
  });

  const anyError = dataError as Error | undefined;

  /* ---- derived stats ---- */
  const stats = useMemo(() => {
    if (!points?.length) return null;

    const avgEff =
      points.reduce((s, p) => s + p.efficiency_wh_km, 0) / points.length;

    const bucketCounts = new Map<number, number[]>();
    for (const p of points) {
      const idx = getTempBucketIndex(p.outside_temp);
      const arr = bucketCounts.get(idx) ?? [];
      arr.push(p.efficiency_wh_km);
      bucketCounts.set(idx, arr);
    }

    const bucketAvgs: BucketAvg[] = tempBuckets.map((b, i) => {
      const vals = bucketCounts.get(i) ?? [];
      const avg = vals.length
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : 0;
      return { label: b.label, avg: toDispEff(avg), count: vals.length, color: b.color };
    });

    const withData = bucketAvgs.filter((b) => b.count > 0);
    const best = withData.reduce(
      (a, b) => (b.avg < a.avg ? b : a),
      withData[0],
    );
    const worst = withData.reduce(
      (a, b) => (b.avg > a.avg ? b : a),
      withData[0],
    );

    return { avgEff: toDispEff(avgEff), bucketAvgs, best, worst, total: points.length };
  }, [points, tempBuckets, toDispEff]);

  /* ---- scatter data with colour per point ---- */
  const scatterData = useMemo(
    () =>
      (points ?? []).map((p) => ({
        ...p,
        outside_temp: toTemperatureDisplay(p.outside_temp),
        efficiency_wh_km: toDispEff(p.efficiency_wh_km),
        fill: TEMP_BUCKETS_C[getTempBucketIndex(p.outside_temp)].color,
      })),
    [points, toTemperatureDisplay, toDispEff],
  );

  /* ---- contextual tips ---- */
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

  /* ---- vehicle selector action ---- */
  const vehicleSelector = <VehicleSelect />;

  // hasData removed
  const bestLabel = stats?.best?.label;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('tempImpact.title', 'Temperature Impact')}
      subtitle={t('tempImpact.subtitle', 'How outside temperature affects driving efficiency')}
      loading={isLoading}
      actions={vehicleSelector}
    >
      <div className="space-y-6">
        {anyError && (
          <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
          </AlertBanner>
        )}

        {/* ── Summary MetricCards ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FadeIn>
            <MetricCard
              label={t('tempImpact.avgEfficiency', 'Avg Efficiency')}
              value={stats ? `${fmtNumber(stats.avgEff)} ${effLabel}` : '—'}
              icon={<Thermometer className="h-4 w-4" />}
              color="cyan"
            />
          </FadeIn>
          <FadeIn delay={0.05}>
            <MetricCard
              label={t('tempImpact.bestRange', 'Best Temp Range')}
              value={stats?.best?.label ?? '—'}
              icon={<TrendingUp className="h-4 w-4" />}
              color="green"
              subtitle={stats?.best ? `${fmtNumber(stats.best.avg)} ${effLabel}` : undefined}
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <MetricCard
              label={t('tempImpact.worstRange', 'Worst Temp Range')}
              value={stats?.worst?.label ?? '—'}
              icon={<Sun className="h-4 w-4" />}
              color="purple"
              subtitle={stats?.worst ? `${fmtNumber(stats.worst.avg)} ${effLabel}` : undefined}
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <MetricCard
              label={t('tempImpact.totalPoints', 'Total Data Points')}
              value={stats?.total ?? 0}
              icon={<Thermometer className="h-4 w-4" />}
              color="cyan"
            />
          </FadeIn>
        </div>

        {/* ── Scatter Chart: Temperature vs Efficiency ─────────── */}
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
              {t('tempImpact.scatterTitle', 'Temperature vs Efficiency')}
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="outside_temp"
                    type="number"
                    name={`${t('tempImpact.temperature', 'Temperature')} (${tempUnit})`}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    label={{
                      value: `${t('tempImpact.temperature', 'Temperature')} (${tempUnit})`,
                      position: 'insideBottom',
                      offset: -5,
                      style: { fill: 'var(--text-muted)', fontSize: 10 },
                    }}
                  />
                  <YAxis
                    dataKey="efficiency_wh_km"
                    type="number"
                    name={`${t('tempImpact.efficiency', 'Efficiency')} (${effLabel})`}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    label={{
                      value: effLabel,
                      angle: -90,
                      position: 'insideLeft',
                      style: { fill: 'var(--text-muted)', fontSize: 10 },
                    }}
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
                  <Scatter
                    data={scatterData}
                    name={t('tempImpact.scatterName', 'Drives')}
                    fill={CHART_COLORS[0]}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* ── Line Chart: Efficiency by Temperature Range ──────── */}
        <FadeIn delay={0.25}>
          <GlassPanel className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
              {t('tempImpact.bucketTitle', 'Efficiency by Temperature Range')}
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={stats?.bucketAvgs ?? []}
                  margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    label={{
                      value: effLabel,
                      angle: -90,
                      position: 'insideLeft',
                      style: { fill: 'var(--text-muted)', fontSize: 10 },
                    }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="avg"
                    name={`${t('tempImpact.avgEff', 'Avg Efficiency')} (${effLabel})`}
                    stroke={CHART_COLORS[0]}
                    dot={{ r: 5, fill: CHART_COLORS[0] }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* ── Optimal Temperature Analysis ─────────────────────── */}
        {stats?.best && (
          <FadeIn delay={0.3}>
            <GlassPanel glow="green" className="p-6">
              <div className="flex items-start gap-4">
                <Thermometer className="h-8 w-8 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t('tempImpact.optimalTitle', 'Optimal Temperature Analysis')}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {t('tempImpact.optimalDesc', {
                      range: stats.best.label,
                      efficiency: fmtNumber(stats.best.avg),
                      unit: effLabel,
                      count: stats.best.count,
                      defaultValue:
                        'Your most efficient temperature range is {{range}} with an average of {{efficiency}} {{unit}} across {{count}} drives.',
                    })}
                  </p>
                  {stats.worst && stats.best.label !== stats.worst.label && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {t('tempImpact.optimalDelta', {
                        worst: stats.worst.label,
                        delta: fmtNumber(stats.worst.avg - stats.best.avg),
                        unit: effLabel,
                        defaultValue:
                          'Compared to the worst range ({{worst}}), you save {{delta}} {{unit}} on average.',
                      })}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
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
              </div>
            </GlassPanel>
          </FadeIn>
        )}

        {/* ── Tips & Recommendations ──────────────────────────── */}
        <FadeIn delay={0.35}>
          <GlassPanel className="p-6">
            <h3
              className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"
            >
              <Lightbulb className="h-4 w-4 text-amber-400" />
              {t('tempImpact.tipsTitle', 'Recommendations')}
            </h3>
            {tips.length > 0 ? (
              <ul className={cn('space-y-2')}>
                {tips.map((tip) => {
                  const Icon = tip.icon;
                  return (
                    <li key={tip.text} className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-current opacity-60" />
                      <Badge variant={tip.variant} size="sm" dot>
                        {tip.text}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8 opacity-20" />}
                message={t('common.noData', 'No data available')}
                className="py-8"
              />
            )}
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
