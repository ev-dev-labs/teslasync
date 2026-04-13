import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Thermometer, Snowflake, Sun, Lightbulb, TrendingUp,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { MetricCard } from '@/components/data-display/MetricCard';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, ReferenceLine,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
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

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
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

const TEMP_BUCKETS: BucketDef[] = [
  { label: '< 0°C', min: -50, max: 0, color: '#3b82f6' },
  { label: '0–10°C', min: 0, max: 10, color: '#06b6d4' },
  { label: '10–20°C', min: 10, max: 20, color: '#10b981' },
  { label: '20–30°C', min: 20, max: 30, color: '#f59e0b' },
  { label: '> 30°C', min: 30, max: 60, color: '#ef4444' },
];

const DEFAULT_BUCKET = TEMP_BUCKETS[2];

function getTempBucket(temp: number): BucketDef {
  return TEMP_BUCKETS.find((b) => temp >= b.min && temp < b.max) ?? DEFAULT_BUCKET;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function TemperatureImpactPage() {
  usePageTitle('Temperature Impact');
  const { t } = useTranslation();

  /* ---- vehicles ---- */
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const vehicleId = selectedVehicle || String(vehicles?.[0]?.id ?? '');

  /* ---- temperature data ---- */
  const { data: points, isLoading } = useQuery({
    queryKey: ['temperature-impact', vehicleId],
    queryFn: () =>
      request<TempEfficiencyPoint[]>(
        `/analytics/temperature-impact?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId !== '',
  });

  /* ---- derived stats ---- */
  const stats = useMemo(() => {
    if (!points?.length) return null;

    const avgEff =
      points.reduce((s, p) => s + p.efficiency_wh_km, 0) / points.length;

    const bucketMap = new Map<string, number[]>();
    for (const p of points) {
      const b = getTempBucket(p.outside_temp);
      const arr = bucketMap.get(b.label) ?? [];
      arr.push(p.efficiency_wh_km);
      bucketMap.set(b.label, arr);
    }

    const bucketAvgs: BucketAvg[] = TEMP_BUCKETS.map((b) => {
      const vals = bucketMap.get(b.label) ?? [];
      const avg = vals.length
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : 0;
      return { label: b.label, avg, count: vals.length, color: b.color };
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

    return { avgEff, bucketAvgs, best, worst, total: points.length };
  }, [points]);

  /* ---- scatter data with colour per point ---- */
  const scatterData = useMemo(
    () =>
      (points ?? []).map((p) => ({
        ...p,
        fill: getTempBucket(p.outside_temp).color,
      })),
    [points],
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
    const cold = stats.bucketAvgs.find((b) => b.label === '< 0°C');
    if (cold && cold.count > 0) {
      items.push({
        icon: Snowflake,
        text: t('tempImpact.tipCold', 'Precondition your cabin in cold weather to reduce battery drain'),
        variant: 'info',
      });
    }
    const hot = stats.bucketAvgs.find((b) => b.label === '> 30°C');
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
  const vehicleSelector =
    vehicles && vehicles.length > 1 ? (
      <Select
        options={vehicles.map((v) => ({
          value: String(v.id),
          label: v.display_name || v.vin,
        }))}
        value={vehicleId}
        onChange={(e) => setSelectedVehicle(e.target.value)}
      />
    ) : undefined;

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
      empty={!isLoading && !points?.length}
      emptyMessage={t('tempImpact.empty', 'No temperature data available. Drive data with temperature readings is needed.')}
      actions={vehicleSelector}
    >
      <div className="space-y-6">
        {/* ── Summary MetricCards ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FadeIn>
            <MetricCard
              label={t('tempImpact.avgEfficiency', 'Avg Efficiency')}
              value={stats ? `${fmtNumber(stats.avgEff)} Wh/km` : '—'}
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
              subtitle={stats?.best ? `${fmtNumber(stats.best.avg)} Wh/km` : undefined}
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <MetricCard
              label={t('tempImpact.worstRange', 'Worst Temp Range')}
              value={stats?.worst?.label ?? '—'}
              icon={<Sun className="h-4 w-4" />}
              color="purple"
              subtitle={stats?.worst ? `${fmtNumber(stats.worst.avg)} Wh/km` : undefined}
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
                    name={t('tempImpact.axisTemp', 'Temperature (°C)')}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    label={{
                      value: t('tempImpact.axisTemp', 'Temperature (°C)'),
                      position: 'insideBottom',
                      offset: -5,
                      style: { fill: 'var(--text-muted)', fontSize: 10 },
                    }}
                  />
                  <YAxis
                    dataKey="efficiency_wh_km"
                    type="number"
                    name={t('tempImpact.axisEff', 'Efficiency (Wh/km)')}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    label={{
                      value: 'Wh/km',
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
                      value: 'Wh/km',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fill: 'var(--text-muted)', fontSize: 10 },
                    }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name={t('tempImpact.avgEffLine', 'Avg Efficiency (Wh/km)')}
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
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
                      count: stats.best.count,
                      defaultValue:
                        'Your most efficient temperature range is {{range}} with an average of {{efficiency}} Wh/km across {{count}} drives.',
                    })}
                  </p>
                  {stats.worst && stats.best.label !== stats.worst.label && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {t('tempImpact.optimalDelta', {
                        worst: stats.worst.label,
                        delta: fmtNumber(stats.worst.avg - stats.best.avg),
                        defaultValue:
                          'Compared to the worst range ({{worst}}), you save {{delta}} Wh/km on average.',
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
                          {b.label}: {fmtNumber(b.avg)} Wh/km
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        )}

        {/* ── Tips & Recommendations ──────────────────────────── */}
        {tips.length > 0 && (
          <FadeIn delay={0.35}>
            <GlassPanel className="p-6">
              <h3
                className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"
              >
                <Lightbulb className="h-4 w-4 text-amber-400" />
                {t('tempImpact.tipsTitle', 'Recommendations')}
              </h3>
              <ul className={clsx('space-y-2')}>
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
            </GlassPanel>
          </FadeIn>
        )}
      </div>
    </PageContainer>
  );
}
