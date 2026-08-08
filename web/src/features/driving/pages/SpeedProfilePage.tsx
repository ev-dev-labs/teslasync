import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Zap, TrendingUp, Car, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, SectionTitle, Text, Caption } from '@/components/ui';
import {
  ChartTooltip,
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LinearGauge,
} from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';

import { useRangeState } from '@/hooks/useRangeState';
import { useSpeedProfile, useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Map a speed-bucket label to a semantic accent (chip neon + chart fill). */
export function bucketAccent(range: string): { neon: NeonColor; fill: string } {
  if (range.startsWith('0') || range.includes('15')) return { neon: 'green', fill: '#10b981' };
  if (range.startsWith('30') || range.includes('45')) return { neon: 'cyan', fill: '#00f0ff' };
  if (range.startsWith('60') || range.includes('75')) return { neon: 'amber', fill: '#f59e0b' };
  return { neon: 'red', fill: '#ef4444' };
}

export function bucketIcon(range: string) {
  if (range.includes('30') || range.startsWith('0')) return <Car className="h-4 w-4" aria-hidden="true" />;
  if (range.includes('60') || range.includes('90')) return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
  return <Gauge className="h-4 w-4" aria-hidden="true" />;
}

/** Toned 300-level accent for an efficiency figure (lower Wh = better). */
export function efficiencyClass(eff: number): string {
  if (eff < 160) return 'text-emerald-300';
  if (eff < 220) return 'text-amber-300';
  return 'text-rose-300';
}

/** Wh per km for a drive, from measured energy or a battery-delta estimate. */
export function getEfficiency(drive: Drive): number | null {
  if (!(drive.distanceM > 0)) return null;
  if (drive.energyUsedWh != null && drive.energyUsedWh > 0) {
    return drive.energyUsedWh / (drive.distanceM / 1000);
  }
  const battUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (battUsed > 0) return (battUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  return null;
}

/* ------------------------------------------------------------------ */
/*  SpeedProfilePage                                                  */
/* ------------------------------------------------------------------ */

export default function SpeedProfilePage() {
  const { t } = useTranslation();
  usePageTitle(t('speedProfile.title', 'Speed Profile'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start, end, setRange } = useRangeState({
    persistKey: 'speed-profile.range',
    defaultPresetId: 'all',
  });

  const { data, isLoading, error, refetch } = useSpeedProfile(vehicleIdStr, start, end);
  const {
    data: allDrives,
    isLoading: drivesLoading,
    error: drivesError,
    refetch: refetchDrives,
  } = useDrives(vehicleIdStr);

  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => (unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm),
    [unitPrefs.distance],
  );

  // Narrow the drives feeding the scatter + per-bucket efficiency table to the
  // picked window so they stay visually consistent with the backend-side
  // distribution window.
  const drives = useMemo(() => {
    const list = allDrives ?? [];
    if (list.length === 0) return list;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return list.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const totalReadings = useMemo(
    () => (data?.distribution ?? []).reduce((s, b) => s + (b.readings ?? 0), 0),
    [data],
  );

  const distributionChartData = useMemo(
    () =>
      (data?.distribution ?? []).map((b) => ({
        range: b.speedBucket ?? b.speed_bucket ?? '',
        readings: b.readings ?? 0,
      })),
    [data],
  );

  const buckets = useMemo(
    () =>
      (data?.distribution ?? []).map((b) => {
        const range = b.speedBucket ?? b.speed_bucket ?? '';
        const readings = b.readings ?? 0;
        return {
          range,
          readings,
          pct: totalReadings > 0 ? (readings / totalReadings) * 100 : 0,
        };
      }),
    [data, totalReadings],
  );

  /* ---- Speed vs Efficiency scatter from drives ---- */
  const scatterData = useMemo(() => {
    const points: { speed: number; efficiency: number; color: string }[] = [];
    for (const d of drives) {
      const raw = getEfficiency(d);
      if (d.avgSpeedMps == null || raw == null) continue;
      const eff = toEfficiencyDisplay(raw);
      points.push({
        speed: Math.round(toSpeedDisplay(d.avgSpeedMps)),
        efficiency: Math.round(eff),
        color: eff < 140 ? '#10b981' : eff < 200 ? '#00f0ff' : eff < 260 ? '#f59e0b' : '#ef4444',
      });
    }
    return points;
  }, [drives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Per-bucket efficiency from drives ---- */
  const bucketEfficiency = useMemo(() => {
    const acc = new Map<string, { totalEff: number; totalSpdMps: number; count: number }>();
    const ranges = data?.distribution ?? [];
    drives.forEach((d) => {
      if (d.avgSpeedMps == null) return;
      const eff = getEfficiency(d);
      if (eff == null) return;
      // Bucket labels ("0-15", "15-30", …) are in the user's display speed
      // unit, so compare against the converted value while accumulating the
      // SI value (m/s) for later conversion at display.
      const speedDisplay = toSpeedDisplay(d.avgSpeedMps);
      for (const r of ranges) {
        const bucket = r.speedBucket ?? r.speed_bucket ?? '';
        const parts = bucket.match(/(\d+)/g);
        if (!parts) continue;
        const lo = Number(parts[0]);
        const hi = parts.length > 1 ? Number(parts[1]) : Number.POSITIVE_INFINITY;
        if (speedDisplay >= lo && speedDisplay < hi) {
          const existing = acc.get(bucket) ?? { totalEff: 0, totalSpdMps: 0, count: 0 };
          existing.totalEff += eff;
          existing.totalSpdMps += d.avgSpeedMps;
          existing.count += 1;
          acc.set(bucket, existing);
          break;
        }
      }
    });
    const result = new Map<string, { avgEff: number; avgSpeedMps: number }>();
    acc.forEach((v, k) =>
      result.set(k, { avgEff: v.totalEff / v.count, avgSpeedMps: v.totalSpdMps / v.count }),
    );
    return result;
  }, [drives, data, toSpeedDisplay]);

  const hasDistribution = distributionChartData.length > 0;

  const kpiSpeed = (mps: number | null | undefined) =>
    data ? fmtNumber(toSpeedDisplay(mps ?? 0), 0) : '—';

  return (
    <PageContainer
      title={t('speedProfile.title', 'Speed Profile')}
      subtitle={t('speedProfile.subtitle', 'Speed distribution and driving pattern analysis')}
      loading={isLoading && !data}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="speed-profile-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('speedProfile.summaryAria', 'Speed summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:gap-5"
        >
          <MetricCard
            label={t('speedProfile.avgSpeed', 'Avg Speed')}
            value={kpiSpeed(data?.avgSpeedMps)}
            subtitle={speedUnit}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('speedProfile.peakSpeed', 'Peak Speed')}
            value={kpiSpeed(data?.peakSpeedMps)}
            subtitle={speedUnit}
            icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
            color="red"
          />
          <MetricCard
            label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
            value={kpiSpeed(data?.optimalSpeedMps)}
            subtitle={speedUnit}
            icon={<Zap className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('speedProfile.samples', 'Samples')}
            value={data ? fmtNumber(totalReadings, 0) : '—'}
            subtitle={t('speedProfile.drivesAnalyzed', '{{count}} drives analysed', {
              count: drives.length,
            })}
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
        </section>
      </FadeIn>

      {/* 2 — Hero bento: distribution chart + speed-envelope gauges */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">{t('speedProfile.distribution', 'Speed Distribution')}</PanelTitle>
            {error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={288} />
            ) : !hasDistribution ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={t('speedProfile.noDistribution', 'No speed distribution available yet')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div
                className="h-64 sm:h-72 xl:h-80"
                role="img"
                aria-label={t('speedProfile.distributionAria', 'Speed-bucket time-share distribution bar chart')}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="readings" name={t('speedProfile.readings', 'Readings')} radius={[4, 4, 0, 0]}>
                      {distributionChartData.map((b) => (
                        <Cell key={b.range} fill={bucketAccent(b.range).fill} fillOpacity={0.75} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-1">{t('speedProfile.envelope', 'Speed Envelope')}</PanelTitle>
            <Caption className="mb-3 block">
              {t('speedProfile.envelopeHint', 'Average, peak and most-efficient speed')}
            </Caption>
            {error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={160} />
            ) : !data ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={t('speedProfile.noData', 'No speed profile data available yet')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="grid grid-cols-3 items-start gap-1 sm:gap-2">
                <LinearGauge
                  value={Math.round(toSpeedDisplay(data.avgSpeedMps ?? 0))}
                  max={Math.max(1, Math.round(toSpeedDisplay(55.56)))}
                  label={t('speedProfile.avgSpeed', 'Avg Speed')}
                  unit={speedUnit}
                  color="#00f0ff"
                  size={96}
                />
                <LinearGauge
                  value={Math.round(toSpeedDisplay(data.peakSpeedMps ?? 0))}
                  max={Math.max(1, Math.round(toSpeedDisplay(69.44)))}
                  label={t('speedProfile.peakSpeed', 'Peak Speed')}
                  unit={speedUnit}
                  color="#ef4444"
                  size={96}
                />
                <LinearGauge
                  value={Math.round(toSpeedDisplay(data.optimalSpeedMps ?? 0))}
                  max={Math.max(1, Math.round(toSpeedDisplay(55.56)))}
                  label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
                  unit={speedUnit}
                  color="#10b981"
                  size={96}
                />
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Per-bucket detail cards */}
      <FadeIn delay={0.2}>
        <section aria-label={t('speedProfile.buckets', 'Speed Buckets')}>
          <SectionTitle className="mb-3">{t('speedProfile.buckets', 'Speed Buckets')}</SectionTitle>
          {error ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={148} />
              ))}
            </div>
          ) : buckets.length === 0 ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={t('speedProfile.noBuckets', 'No speed buckets recorded for this window')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
              {buckets.map((bucket) => {
                const accent = bucketAccent(bucket.range);
                const chip = neonColorMap[accent.neon];
                const effData = bucketEfficiency.get(bucket.range);
                return (
                  <GlassPanel key={bucket.range} className="flex h-full flex-col p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1',
                          chip.bg,
                          chip.ring,
                          chip.text,
                        )}
                      >
                        {bucketIcon(bucket.range)}
                      </span>
                      <Text size="xs" weight="semibold" color="primary" className="tabular-nums">
                        {bucket.range}
                      </Text>
                    </div>
                    <dl className="flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Text as="dt" variant="caption">{t('speedProfile.timeShare', 'Time share')}</Text>
                        <Text as="dd" size="sm" weight="bold" className={chip.text}>
                          {fmtNumber(bucket.pct, 1)}%
                        </Text>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Text as="dt" variant="caption">{t('speedProfile.readings', 'Readings')}</Text>
                        <Text as="dd" size="sm" weight="bold" color="secondary" className="tabular-nums">
                          {fmtNumber(bucket.readings, 0)}
                        </Text>
                      </div>
                      {effData ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <Text as="dt" variant="caption">{t('speedProfile.avgSpeed', 'Avg Speed')}</Text>
                            <Text as="dd" size="sm" weight="bold" color="secondary" className="tabular-nums">
                              {fmtNumber(toSpeedDisplay(effData.avgSpeedMps), 0)} {speedUnit}
                            </Text>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <Text as="dt" variant="caption">{efficiencyUnit}</Text>
                            <Text
                              as="dd"
                              size="sm"
                              weight="bold"
                              className={cn('tabular-nums', efficiencyClass(effData.avgEff))}
                            >
                              {fmtNumber(toEfficiencyDisplay(effData.avgEff), 0)}
                            </Text>
                          </div>
                        </>
                      ) : null}
                    </dl>
                  </GlassPanel>
                );
              })}
            </div>
          )}
        </section>
      </FadeIn>

      {/* 4 — Secondary bento: efficiency scatter + insight */}
      <FadeIn delay={0.3}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-1">{t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}</PanelTitle>
            <Caption className="mb-3 block">
              {t('speedProfile.lower', 'Lower')} {efficiencyUnit} = {t('speedProfile.better', 'better')}
            </Caption>
            {drivesError ? (
              <QueryError error={drivesError} onRetry={() => refetchDrives()} />
            ) : drivesLoading ? (
              <Skeleton height={240} />
            ) : scatterData.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                message={t('speedProfile.noScatter', 'Not enough drive data for the efficiency scatter yet')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <>
                <div
                  className="h-56 sm:h-64 xl:h-72"
                  role="img"
                  aria-label={t('speedProfile.effVsSpeedAria', 'Per-drive efficiency versus speed scatter plot')}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis
                        dataKey="speed"
                        name={t('speedProfile.speed', 'Speed')}
                        unit={` ${speedUnit}`}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <YAxis
                        dataKey="efficiency"
                        name={efficiencyUnit}
                        unit={` ${efficiencyUnit}`}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Scatter data={scatterData} fillOpacity={0.75}>
                        {scatterData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  <ScatterLegend colorClass="bg-emerald-400" label={t('speedProfile.efficient', 'Efficient')} />
                  <ScatterLegend colorClass="bg-amber-400" label={t('speedProfile.moderate', 'Moderate')} />
                  <ScatterLegend colorClass="bg-rose-400" label={t('speedProfile.highConsumption', 'High consumption')} />
                </div>
              </>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3">{t('speedProfile.insightTitle', 'Efficiency Insight')}</PanelTitle>
            {error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={120} />
            ) : (data?.optimalSpeedMps ?? 0) > 0 ? (
              <div className="flex items-start gap-3 rounded-lg border-l-2 border-emerald-400/70 bg-emerald-400/5 p-3">
                <Zap className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
                <Text as="p" size="sm" color="secondary">
                  {t('speedProfile.insightText', 'Drives around {{speed}} {{unit}} show the best energy efficiency. Reducing highway speed could improve efficiency by ~15%.', {
                    speed: fmtNumber(toSpeedDisplay(data?.optimalSpeedMps ?? 0), 0),
                    unit: speedUnit,
                  })}
                </Text>
              </div>
            ) : (
              <EmptyState
                icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                message={t('speedProfile.noInsight', 'Efficiency insight appears once optimal-speed data is available')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}

/** Coloured legend chip for the efficiency scatter (colour paired with text). */
function ScatterLegend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-2 w-2 rounded-full', colorClass)} aria-hidden="true" />
      <Caption>{label}</Caption>
    </span>
  );
}
