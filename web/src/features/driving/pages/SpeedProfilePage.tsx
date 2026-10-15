import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Zap, TrendingUp, Car, Activity } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle, SectionTitle, Text, Caption } from '@/components/ui';
import {
  ChartTooltip,
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LinearGauge, EmbeddedChart, axisTick,
} from '@/components/charts';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { DrivingSummaryBrief } from '../components/operationalbrief-n-z/DrivingSummaryBrief';
import { DynamicsPausedNotice } from '../components/driving-dynamics-modernization/DynamicsPausedNotice';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, SectionErrorBoundary } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';


import { useRangeState } from '@/hooks/useRangeState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSpeedProfile, useDriveCalendarHistory } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';

import { getEfficiency } from '@/lib/drivesAggregation';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import { convertSpeedFromSI, convertEfficiencyFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Map a speed-bucket label to a semantic accent (chip neon + chart fill). */
export function bucketAccent(range: string): { neon: NeonColor; fill: string } {
  if (range.startsWith('0') || range.includes('15')) return { neon: 'green', fill: 'var(--semantic-success)' };
  if (range.startsWith('30') || range.includes('45')) return { neon: 'cyan', fill: 'var(--semantic-info)' };
  if (range.startsWith('60') || range.includes('75')) return { neon: 'amber', fill: 'var(--semantic-warning)' };
  return { neon: 'red', fill: 'var(--semantic-danger)' };
}

export function bucketIcon(range: string) {
  if (range.includes('30') || range.startsWith('0')) return <Car className="h-4 w-4" aria-hidden="true" />;
  if (range.includes('60') || range.includes('90')) return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
  return <Gauge className="h-4 w-4" aria-hidden="true" />;
}

/** Toned 300-level accent for an efficiency figure (lower Wh = better). */
export function efficiencyClass(eff: number): string {
  if (eff < 160) return neonColorMap.green.text;
  if (eff < 220) return neonColorMap.amber.text;
  return neonColorMap.red.text;
}

export { getEfficiency };

/**
 * Efficiency bands for the scatter. Thresholds stay in raw SI (Wh/km) so a
 * drive's band never depends on the viewer's distance unit; only the legend
 * text converts them for display.
 */
export const EFFICIENCY_BANDS = [
  { id: 'efficient', maxWhPerKm: 140, color: 'var(--semantic-success)', chip: 'bg-[var(--semantic-success)]', labelKey: 'speedProfile.efficient', fallback: 'Efficient' },
  { id: 'typical', maxWhPerKm: 200, color: 'var(--semantic-info)', chip: 'bg-[var(--semantic-info)]', labelKey: 'speedProfile.typical', fallback: 'Typical' },
  { id: 'moderate', maxWhPerKm: 260, color: 'var(--semantic-warning)', chip: 'bg-[var(--semantic-warning)]', labelKey: 'speedProfile.moderate', fallback: 'Moderate' },
  { id: 'high', maxWhPerKm: Number.POSITIVE_INFINITY, color: 'var(--semantic-danger)', chip: 'bg-[var(--semantic-danger)]', labelKey: 'speedProfile.highConsumption', fallback: 'High consumption' },
] as const;

export function efficiencyBand(whPerKm: number) {
  return EFFICIENCY_BANDS.find((band) => whPerKm < band.maxWhPerKm) ?? EFFICIENCY_BANDS[EFFICIENCY_BANDS.length - 1];
}

/* ------------------------------------------------------------------ */
/*  SpeedProfilePage                                                  */
/* ------------------------------------------------------------------ */

export default function SpeedProfilePage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('speedProfile.title', 'Speed Profile'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { tz } = useDateFormat();
  const { start, end, startInstant, endInstantExclusive } = useRangeState({ timezone: tz });

  const profileQuery = useSpeedProfile(vehicleIdStr, startInstant, endInstantExclusive);
  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, startInstant, endInstantExclusive);
  const profileState = useDataState(profileQuery, { provenance: 'historical' });
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const missingSelection = vehicleId == null;
  const data = missingSelection ? undefined : profileState.data;
  const allDrives = missingSelection ? undefined : drivesState.data;
  const profilePaused = !missingSelection && !profileState.hasData
    && profileState.isRefreshBlocked && !profileState.fatalError;
  const drivesPaused = !missingSelection && !drivesState.hasData
    && drivesState.isRefreshBlocked && !drivesState.fatalError;
  const isLoading = !missingSelection && profileState.status === 'initial' && !profilePaused;
  const drivesLoading = !missingSelection && drivesState.status === 'initial' && !drivesPaused;
  const error = missingSelection ? null : profileState.fatalError;
  const drivesError = missingSelection ? null : drivesState.fatalError;
  const { refetch } = profileQuery;
  const { refetch: refetchDrives } = drivesQuery;

  const { unitPrefs } = useUnits();
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const chartTick = { ...axisTick, fontFamily: getChartFontFamily(), fontSize: getChartFontSize() };

  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => convertEfficiencyFromSI(whPerKm, unitPrefs.distance),
    [unitPrefs.distance],
  );

  // Narrow the drives feeding the scatter + per-bucket efficiency table to the
  // picked window so they stay visually consistent with the backend-side
  // distribution window.
  const drives = useMemo(() => {
    const list = allDrives ?? [];
    if (list.length === 0) return list;
    const startMs = Date.parse(startInstant);
    const endMs = Date.parse(endInstantExclusive);
    return list.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts < endMs;
    });
  }, [allDrives, startInstant, endInstantExclusive]);
  const authoritativeNoDrives = drivesState.hasData && allDrives?.length === 0;
  const sampleNoMatch = (allDrives?.length ?? 0) > 0 && drives.length === 0;

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
      if (d.avgSpeedMps == null || !Number.isFinite(d.avgSpeedMps)
        || raw == null || !Number.isFinite(raw)) continue;
      const eff = toEfficiencyDisplay(raw);
      points.push({
        speed: toSpeedDisplay(d.avgSpeedMps),
        efficiency: eff,
        color: efficiencyBand(raw).color,
      });
    }
    return points;
  }, [drives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Per-bucket efficiency from drives ---- */
  const bucketEfficiency = useMemo(() => {
    const acc = new Map<string, { totalEff: number; totalSpdMps: number; count: number }>();
    const ranges = data?.distribution ?? [];
    drives.forEach((d) => {
      if (d.avgSpeedMps == null || !Number.isFinite(d.avgSpeedMps)) return;
      const eff = getEfficiency(d);
      if (eff == null || !Number.isFinite(eff)) return;
      // The source distribution uses fixed mph bands, independently of viewer
      // preferences. Compare in that source unit; retain raw SI accumulators
      // and convert averages only when displaying them.
      const sourceSpeedMph = convertSpeedFromSI(d.avgSpeedMps, 'mph');
      for (const r of ranges) {
        const bucket = r.speedBucket ?? r.speed_bucket ?? '';
        const parts = bucket.match(/(\d+)/g);
        if (!parts) continue;
        const lo = Number(parts[0]);
        const hi = parts.length > 1 ? Number(parts[1]) : Number.POSITIVE_INFINITY;
        if (sourceSpeedMph >= lo && sourceSpeedMph < hi) {
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
  }, [drives, data]);

  const hasDistribution = distributionChartData.length > 0;
  const profileRetained = !missingSelection && profileState.hasData
    && (profileState.status === 'stale' || profileState.refreshError != null || profileState.isRefreshBlocked);
  const drivesRetained = !missingSelection && drivesState.hasData
    && (drivesState.status === 'stale' || drivesState.refreshError != null || drivesState.isRefreshBlocked);
  const selectionMessage = t('driving.brief.selectVehicle', 'Select a vehicle');
  const pausedMessage = t('dataSources.status.paused', 'Refresh paused');
  const profilePlaceholder = missingSelection || profilePaused
    ? <EmptyState /* no-action: this informational panel has no local recovery action; parent-page source controls remain available. */ message={missingSelection ? selectionMessage : pausedMessage} />
    : null;
  const drivesPlaceholder = missingSelection || drivesPaused
    ? <EmptyState /* no-action: this informational panel has no local recovery action; parent-page source controls remain available. */ message={missingSelection ? selectionMessage : pausedMessage} />
    : null;
  const driveValueStatus = missingSelection
    ? selectionMessage
    : drivesPaused
      ? pausedMessage
      : drivesLoading
        ? t('driving.brief.loading', 'Loading source')
        : drivesError || authoritativeNoDrives
          ? t('common.unavailable', 'Unavailable')
          : t('common.unknown', 'Unknown');

  const displaySpeed = (mps: number | null | undefined) =>
    mps != null && Number.isFinite(mps) ? toSpeedDisplay(mps) : null;
  const gaugeSpeed = (mps: number | null | undefined) => {
    const value = displaySpeed(mps);
    return value != null ? Math.round(value) : null;
  };
  const summaryMetrics: readonly StatMetric[] = [
    { metricId: 'speed', occurrenceId: 'average-speed', rawValue: data?.avgSpeedMps,
      label: t('speedProfile.avgSpeed', 'Avg Speed') },
    { metricId: 'speed', occurrenceId: 'peak-speed', rawValue: data?.peakSpeedMps,
      label: t('speedProfile.peakSpeed', 'Peak Speed') },
    { metricId: 'speed', occurrenceId: 'optimal-speed', rawValue: data?.optimalSpeedMps,
      label: t('speedProfile.optimalSpeed', 'Optimal Speed') },
    { metricId: 'count', occurrenceId: 'samples', rawValue: data ? totalReadings : null,
      label: t('speedProfile.eligibleDrives', 'Eligible drives'),
      context: !missingSelection && drivesState.hasData && !sampleNoMatch
        ? t('speedProfile.drivesAnalyzed', '{{count}} drives analysed', { count: drives.length })
        : t('speedProfile.brief.driveCoverageUnknown', 'Drive sample coverage is unavailable independently of the speed profile.') },
  ];

  return (
    <PageLayout
      title={t('speedProfile.title', 'Speed Profile')}
      subtitle={t('speedProfile.subtitle', 'Speed distribution and driving pattern analysis')}
      query={[profileQuery, drivesQuery]}
      busy={!missingSelection && (profileQuery.isFetching || drivesQuery.isFetching)}
    >
      {!missingSelection && (
        <>
          <StaleRefreshWarning state={profileState} label={t('speedProfile.title', 'Speed Profile')} />
          <StaleRefreshWarning state={drivesState} label={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')} />
          <DynamicsPausedNotice state={profileState} label={t('speedProfile.title', 'Speed Profile')} />
          <DynamicsPausedNotice state={drivesState} label={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')} />
        </>
      )}
      {/* 1 — KPI band */}
      <FadeIn>
        <SectionErrorBoundary name="SpeedProfileSummary">
        <DrivingSummaryBrief
          id="speed-profile-brief"
          title={t('speedProfile.summaryAria', 'Speed summary metrics')}
          description={t('speedProfile.brief.description', 'Recorded speed statistics and eligible-drive counts; efficiency evidence comes from a separate drive query.')}
          metrics={summaryMetrics}
          scope={`${start} — ${end}`}
          provenance={t('speedProfile.brief.provenance', 'Speed-profile aggregate and returned vehicle drives; the server does not declare complete drive coverage.')}
          loading={isLoading}
          unavailable={missingSelection || !profileState.hasData}
          retained={profileRetained}
          sourceStatus={missingSelection ? selectionMessage : profileState.isRefreshBlocked && !error && !profileState.refreshError
            ? t('dataSources.status.paused', 'Refresh paused')
            : !profileState.hasData && !isLoading && !error
              ? t('common.unknown', 'Unknown') : undefined}
          actions={error ? <QueryError error={error} onRetry={() => refetch()} /> : undefined}
        />
        </SectionErrorBoundary>
      </FadeIn>

      {/* 2 — Hero bento: distribution chart + speed-envelope gauges */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <SectionErrorBoundary name="SpeedProfileDistribution">
            <PanelTitle className="mb-3">{t('speedProfile.distribution', 'Speed Distribution')}</PanelTitle>
            <Caption className="mb-3 block">{t('speedProfile.sourceBucketUnit', 'Source speed buckets are in mph; averages use your selected units.')}</Caption>
            <Caption className="mb-3 block">{t('speedProfile.countPopulation', 'Each count is one drive with a recorded average speed greater than zero in the selected vehicle and date range. Shares divide each bucket count by the total eligible-drive count, not by driving time or telemetry samples.')}</Caption>
            {profilePlaceholder ? profilePlaceholder : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={288} />
            ) : !hasDistribution ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={profileState.hasData
                  ? t('speedProfile.noDistribution', 'No speed distribution available yet')
                  : t('common.unknown', 'Unknown')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="h-64 sm:h-72 xl:h-80">
                <EmbeddedChart
                  title={t('speedProfile.distribution', 'Speed Distribution')}
                  ariaLabel={t('speedProfile.distributionAria', 'Eligible-drive counts by average-speed bucket bar chart')}
                  data={distributionChartData}
                  dataColumns={[
                    { key: 'range', label: t('speedProfile.buckets', 'Speed Buckets') },
                    { key: 'readings', label: t('speedProfile.driveCount', 'Drive count'), kind: 'count' },
                  ]}
                  fluid
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distributionChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="range" tick={chartTick} />
                      <YAxis tick={chartTick} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="readings" name={t('speedProfile.driveCount', 'Drive count')} radius={[4, 4, 0, 0]}>
                        {distributionChartData.map((b) => (
                          <Cell key={b.range} fill={bucketAccent(b.range).fill} fillOpacity={0.75} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </EmbeddedChart>
              </div>
            )}
            </SectionErrorBoundary>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <SectionErrorBoundary name="SpeedProfileEnvelope">
            <PanelTitle className="mb-1">{t('speedProfile.envelope', 'Speed Envelope')}</PanelTitle>
            <Caption className="mb-3 block">
              {t('speedProfile.envelopeHint', 'Average, peak and most-efficient speed')}
            </Caption>
            {profilePlaceholder ? profilePlaceholder : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={160} />
            ) : !data ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={t('common.unknown', 'Unknown')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <div className="grid grid-cols-3 items-start gap-1 sm:gap-2">
                <LinearGauge
                  value={gaugeSpeed(data.avgSpeedMps)}
                  max={Math.max(1, Math.round(toSpeedDisplay(55.56)))}
                  label={t('speedProfile.avgSpeed', 'Avg Speed')}
                  unit={speedUnit}
                  tone="info"
                  size={96}
                />
                <LinearGauge
                  value={gaugeSpeed(data.peakSpeedMps)}
                  max={Math.max(1, Math.round(toSpeedDisplay(69.44)))}
                  label={t('speedProfile.peakSpeed', 'Peak Speed')}
                  unit={speedUnit}
                  tone="danger"
                  size={96}
                />
                <LinearGauge
                  value={gaugeSpeed(data.optimalSpeedMps)}
                  max={Math.max(1, Math.round(toSpeedDisplay(55.56)))}
                  label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
                  unit={speedUnit}
                  tone="success"
                  size={96}
                />
              </div>
            )}
            </SectionErrorBoundary>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Per-bucket detail cards */}
      <FadeIn delay={0.2}>
        <section aria-label={t('speedProfile.buckets', 'Speed Buckets')}>
          <SectionTitle className="mb-3">{t('speedProfile.buckets', 'Speed Buckets')}</SectionTitle>
          <Caption className="mb-3 block">{t('speedProfile.sourceBucketUnit', 'Source speed buckets are in mph; averages use your selected units.')}</Caption>
          {profilePlaceholder ? (
            <GlassPanel className="p-4 sm:p-5">{profilePlaceholder}</GlassPanel>
          ) : error ? (
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
                message={profileState.hasData
                  ? t('speedProfile.noBuckets', 'No speed buckets recorded for this window')
                  : t('common.unknown', 'Unknown')}
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
                        <Text as="dt" variant="caption">{t('speedProfile.driveCountShare', 'Drive count share')}</Text>
                        <Text as="dd" size="sm" weight="bold" color="secondary" className="tabular-nums">
                          {fmtNumber(bucket.pct)}%
                        </Text>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Text as="dt" variant="caption">{t('speedProfile.driveCount', 'Drive count')}</Text>
                        <Text as="dd" size="sm" weight="bold" color="secondary" className="tabular-nums">
                          {fmtInt(bucket.readings)}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Text as="dt" variant="caption">{t('speedProfile.avgSpeed', 'Avg Speed')}</Text>
                        <Text as="dd" size="sm" weight="bold" color="secondary" className="tabular-nums">
                          {effData
                            ? `${fmtNumber(toSpeedDisplay(effData.avgSpeedMps))} ${speedUnit}`
                            : driveValueStatus}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Text as="dt" variant="caption">{efficiencyUnit}</Text>
                        <Text
                          as="dd"
                          size="sm"
                          weight="bold"
                          className={cn('tabular-nums', effData && efficiencyClass(effData.avgEff))}
                        >
                          {effData ? fmtNumber(toEfficiencyDisplay(effData.avgEff)) : driveValueStatus}
                        </Text>
                      </div>
                      {drivesRetained && (
                        <Caption as="div">{t('driving.brief.retained', 'Retained source')}</Caption>
                      )}
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
            <SectionErrorBoundary name="SpeedProfileScatter">
            <PanelTitle className="mb-1">{t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}</PanelTitle>
            <Caption className="mb-3 block">
              {t('speedProfile.lower', 'Lower')} {efficiencyUnit} = {t('speedProfile.better', 'better')}
            </Caption>
            {drivesPlaceholder ? drivesPlaceholder : drivesError ? (
              <QueryError error={drivesError} onRetry={() => refetchDrives()} />
            ) : drivesLoading ? (
              <Skeleton height={240} />
            ) : scatterData.length === 0 ? (
              <EmptyState
                icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                message={drivesState.hasData && !sampleNoMatch
                  ? t('speedProfile.noScatter', 'Not enough drive data for the efficiency scatter yet')
                  : t('common.unknown', 'Unknown')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <>
                <div className="h-56 sm:h-64 xl:h-72">
                  <EmbeddedChart
                    title={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}
                    ariaLabel={t('speedProfile.effVsSpeedAria', 'Per-drive efficiency versus speed scatter plot')}
                    data={scatterData}
                    dataColumns={[
                      { key: 'speed', label: `${t('speedProfile.speed', 'Speed')} (${speedUnit})`, format: value => typeof value === 'number' ? fmtNumber(value) : '—' },
                      { key: 'efficiency', label: efficiencyUnit, format: value => typeof value === 'number' ? fmtNumber(value) : '—' },
                    ]}
                    fluid
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis
                          dataKey="speed"
                          name={t('speedProfile.speed', 'Speed')}
                          unit={` ${speedUnit}`}
                          tickFormatter={fmtNumber}
                          tick={chartTick}
                        />
                        <YAxis
                          dataKey="efficiency"
                          name={efficiencyUnit}
                          unit={` ${efficiencyUnit}`}
                          tickFormatter={fmtNumber}
                          tick={chartTick}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Scatter data={scatterData} fillOpacity={0.75}>
                          {scatterData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </EmbeddedChart>
                </div>
                <ul
                  className="mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1"
                  aria-label={t('speedProfile.efficiencyBands', 'Efficiency bands')}
                  data-testid="speed-efficiency-bands"
                >
                  {EFFICIENCY_BANDS.map((band, index) => {
                    const lower = index > 0 ? EFFICIENCY_BANDS[index - 1].maxWhPerKm : null;
                    const format = (whPerKm: number) => fmtInt(toEfficiencyDisplay(whPerKm));
                    const range = lower == null
                      ? t('speedProfile.bandBelow', 'below {{max}} {{unit}}', { max: format(band.maxWhPerKm), unit: efficiencyUnit })
                      : Number.isFinite(band.maxWhPerKm)
                        ? t('speedProfile.bandBetween', '{{min}}–{{max}} {{unit}}', { min: format(lower), max: format(band.maxWhPerKm), unit: efficiencyUnit })
                        : t('speedProfile.bandAtLeast', '{{min}} {{unit}} or more', { min: format(lower), unit: efficiencyUnit });
                    return (
                      <ScatterLegend key={band.id} colorClass={band.chip}
                        label={t('speedProfile.bandLabel', '{{label}}: {{range}}', { label: t(band.labelKey, band.fallback), range })} />
                    );
                  })}
                </ul>
              </>
            )}
            </SectionErrorBoundary>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <SectionErrorBoundary name="SpeedProfileInsight">
            <PanelTitle className="mb-3">{t('speedProfile.insightTitle', 'Efficiency Insight')}</PanelTitle>
            {profilePlaceholder ? profilePlaceholder : error ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : isLoading ? (
              <Skeleton height={120} />
            ) : (data?.optimalSpeedMps ?? 0) > 0 ? (
              <div className="flex items-start gap-3 rounded-lg border-l-2 border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                <Zap className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                <Text as="p" size="sm" color="secondary">
                  {t('speedProfile.insightEvidenceText', 'Drives around {{speed}} {{unit}} show the best energy efficiency. This profile does not quantify efficiency gains from reducing highway speed.', {
                    speed: fmtNumber(toSpeedDisplay(data?.optimalSpeedMps ?? 0)),
                    unit: speedUnit,
                  })}
                </Text>
              </div>
            ) : (
              <EmptyState
                icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                message={profileState.hasData
                  ? t('speedProfile.noInsight', 'Efficiency insight appears once optimal-speed data is available')
                  : t('common.unknown', 'Unknown')}
                actionTo={{ label: t('speedProfile.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            )}
            </SectionErrorBoundary>
          </GlassPanel>
        </section>
      </FadeIn>
    </PageLayout>
  );
}

/** Coloured legend chip for the efficiency scatter (colour paired with text). */
function ScatterLegend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-2 w-2 rounded-full', colorClass)} aria-hidden="true" />
      <Caption>{label}</Caption>
    </li>
  );
}
