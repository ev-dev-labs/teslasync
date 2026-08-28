import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap, TrendingUp, Thermometer, Fuel, Gauge, Car, Leaf, Route,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, DataTable, PanelTitle, SectionTitle, Text,
} from '@/components/ui';
import { GlossaryTerm } from '@/components/ui/GlossaryTerm';
import { MetricCard, MetricBar, SavedViewMenu } from '@/components/data-display';
import {
  ChartContainer, ChartTooltip, renderAnnotationLines,
  AREA_DEFAULTS, areaGradient, LinearGauge,
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from '@/components/charts';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';
import { EmptyState, Skeleton } from '@/components/feedback';
import { EmptyStateGuidanceDetails } from '@/components/feedback/ActionableEmptyState';

import { useDrivingStats, useDrives } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import {
  convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI,
} from '@/lib/unitConversion';
import { getEfficiency } from '@/lib/drivesAggregation';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ceiling for the average-consumption gauge and bar, expressed in **Wh/km**.
 *
 * It must be converted through `toEfficiencyDisplay` before use, exactly like
 * the reading it is compared against. A bare `max={300}` was a Wh/km-sized
 * ceiling applied to Wh/mi values: a perfectly ordinary 250 Wh/mi (155 Wh/km)
 * filled 83% of the ring for a miles user while the identical car showed 52%
 * in km, and anything above 300 Wh/mi pegged the gauge full.
 */
const EFFICIENCY_GAUGE_MAX_WH_PER_KM = 300;

/** Efficiency → color ramp (dynamic; used as a computed chart/dot color). */
export function efficiencyColor(wh: number): string {
  if (wh < 140) return '#39ff14';
  if (wh < 170) return '#10b981';
  if (wh < 200) return '#00f0ff';
  if (wh < 240) return '#f59e0b';
  return '#ef4444';
}

export { getEfficiency };

/* ------------------------------------------------------------------ */
/*  EfficiencyPage                                                     */
/* ------------------------------------------------------------------ */

export default function EfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('efficiency.title', 'Efficiency'));
  const savedView = useSavedViewUrl();

  // The header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const statsQuery = useDrivingStats(vehicleIdStr);
  const drivesQuery = useDrives(vehicleIdStr);
  const { data: stats, isLoading: statsLoading } = statsQuery;
  const { data: drives, isLoading: drivesLoading } = drivesQuery;
  const dataSources = useMemo(
    () => [
      {
        id: 'efficiency-summary',
        label: t('dataSources.labels.efficiencySummary', 'Efficiency summary'),
        query: statsQuery,
      },
      {
        id: 'drive-history',
        label: t('dataSources.labels.driveHistory', 'Drive history'),
        query: drivesQuery,
      },
    ],
    [drivesQuery, statsQuery, t],
  );

  const { unitPrefs, formatDuration, formatEnergy } = useUnits();
  const isFahrenheit = unitPrefs.temperature === '°F';

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  // Per-drive SI converters. `drives` fields are SI (distanceM = meters,
  // avgSpeedMps = m/s, outsideTempAvgC = °C); getEfficiency() returns Wh/km.
  // Memoised so the derived-data useMemo hooks below keep stable dependencies.
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => (unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm),
    [unitPrefs.distance],
  );

  // `useDrivingStats` returns legacy display-scalar fields, NOT SI:
  // totalDistanceKm (km), avgSpeedKmh / topSpeedKmh (km/h), avgEfficiencyWhKm
  // (Wh/km). Bridge km → m and km/h → m/s before the SI converters so both
  // unit preferences render correctly — mirrors FleetComparePage's fromKm/fromKmh.
  const toStatsDistanceDisplay = useCallback(
    (km: number) => convertDistanceFromSI(km * 1000, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const toStatsSpeedDisplay = useCallback(
    (kmh: number) => convertSpeedFromSI((kmh * 1000) / 3600, unitPrefs.speed),
    [unitPrefs.speed],
  );

  const {
    start: startDate, end: endDate, startInstant, endInstantExclusive, setRange,
  } = useRangeState({
    persistKey: 'efficiency.range',
  });

  /* ---- Filtered drives ---- */
  // Compare against the half-open [startInstant, endInstantExclusive) API
  // window rather than a naive `d.startTs.split('T')[0]` vs. calendar-day
  // string comparison. `startTs` is a UTC ISO instant while `startDate`/
  // `endDate` are calendar days resolved in the local timezone — for any
  // vehicle west of UTC, a drive that started "today" locally can carry a
  // UTC date component one day ahead, which the naive string compare
  // dropped as being past `endDate`. See src/lib/dateRange.ts.
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    const startMs = startInstant ? new Date(startInstant).getTime() : undefined;
    const endMs = endInstantExclusive ? new Date(endInstantExclusive).getTime() : undefined;
    return drives.filter((d) => {
      if (!d.startTs) return true;
      const t = new Date(d.startTs).getTime();
      if (Number.isNaN(t)) return true;
      if (startMs !== undefined && t < startMs) return false;
      if (endMs !== undefined && t >= endMs) return false;
      return true;
    });
  }, [drives, startInstant, endInstantExclusive]);

  /* ---- Daily efficiency trend ---- */
  const dailyTrend = useMemo(() => {
    return filteredDrives
      .filter((d) => getEfficiency(d) !== null)
      .slice(0, 30)
      .reverse()
      .map((d) => ({
        date: formatDateShort(d.startTs),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
        distance: parseFloat(fmtNumber(toDistanceDisplay(d.distanceM ?? 0), 1)),
      }));
  }, [filteredDrives, toEfficiencyDisplay, toDistanceDisplay]);

  /* ---- Speed vs Efficiency scatter ---- */
  const speedVsEff = useMemo(() => {
    return filteredDrives
      .filter((d) => d.avgSpeedMps && getEfficiency(d))
      .map((d) => ({
        speed: Math.round(toSpeedDisplay(d.avgSpeedMps!)),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
      }));
  }, [filteredDrives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Temp vs Efficiency scatter ---- */
  const tempVsEff = useMemo(() => {
    return filteredDrives
      .filter((d) => d.outsideTempAvgC !== null && getEfficiency(d))
      .map((d) => ({
        temp: Math.round(toTemperatureDisplay(d.outsideTempAvgC!)),
        efficiency: Math.round(toEfficiencyDisplay(getEfficiency(d)!)),
      }));
  }, [filteredDrives, toTemperatureDisplay, toEfficiencyDisplay]);

  /* ---- Speed distribution ---- */
  const speedDist = useMemo(() => {
    const buckets = [
      { range: `0–30`, min: 0, max: 30, count: 0, totalEff: 0 },
      { range: `30–60`, min: 30, max: 60, count: 0, totalEff: 0 },
      { range: `60–90`, min: 60, max: 90, count: 0, totalEff: 0 },
      { range: `90–120`, min: 90, max: 120, count: 0, totalEff: 0 },
      { range: `120+`, min: 120, max: 999, count: 0, totalEff: 0 },
    ];
    filteredDrives.forEach((d) => {
      if (d.avgSpeedMps == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      const displaySpeed = toSpeedDisplay(d.avgSpeedMps!);
      const b = buckets.find((bk) => displaySpeed >= bk.min && displaySpeed < bk.max);
      if (b) { b.count++; b.totalEff += eff; }
    });
    return buckets.filter((b) => b.count > 0).map((b) => ({
      range: `${b.range} ${speedUnit}`,
      avgEff: Math.round(toEfficiencyDisplay(b.totalEff / b.count)),
      count: b.count,
    }));
  }, [filteredDrives, speedUnit, toEfficiencyDisplay, toSpeedDisplay]);

  /* ---- Temperature-bucketed efficiency ---- */
  const tempBuckets = useMemo(() => {
    const ranges = isFahrenheit
      ? [
          { range: '< 32°F', min: -999, max: 0 },
          { range: '32–50°F', min: 0, max: 10 },
          { range: '50–68°F', min: 10, max: 20 },
          { range: '68–86°F', min: 20, max: 30 },
          { range: '> 86°F', min: 30, max: 999 },
        ]
      : [
          { range: '< 0°C', min: -999, max: 0 },
          { range: '0–10°C', min: 0, max: 10 },
          { range: '10–20°C', min: 10, max: 20 },
          { range: '20–30°C', min: 20, max: 30 },
          { range: '> 30°C', min: 30, max: 999 },
        ];
    const buckets = ranges.map((r) => ({
      ...r,
      count: 0,
      totalEff: 0,
      totalDist: 0,
      totalSpeed: 0,
    }));
    filteredDrives.forEach((d) => {
      if (d.outsideTempAvgC == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      const b = buckets.find((bk) => d.outsideTempAvgC! >= bk.min && d.outsideTempAvgC! < bk.max);
      if (b) {
        b.count++;
        b.totalEff += eff;
        // Accumulate SI (meters, m/s); the DataTable render converts once via
        // toDistanceDisplay / toSpeedDisplay. Converting here too double-converted.
        b.totalDist += d.distanceM;
        b.totalSpeed += d.avgSpeedMps ?? 0;
      }
    });
    return buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        range: b.range,
        count: b.count,
        avgEff: b.totalEff / b.count,
        totalDist: b.totalDist,
        avgSpeed: b.totalSpeed / b.count,
      }));
  }, [filteredDrives, isFahrenheit]);

  /* ---- Computed metrics ---- */
  const costPerKm = stats && stats.totalDistanceKm > 0
    ? fmtNumber((stats.avgEfficiencyWhKm / 1000) * 0.12, 3)
    : '—';
  const distancePerKwh = stats && stats.avgEfficiencyWhKm > 0
    ? fmtNumber(toStatsDistanceDisplay(1000 / stats.avgEfficiencyWhKm), 1)
    : '—';

  /* ---- Energy insight tiles ---- */
  const insights = stats
    ? [
        { key: 'regen', label: t('efficiency.totalRegen', 'Total Regen'), value: formatEnergy(stats.regenEnergyWh ?? 0, { precision: 1 }), icon: <Zap className="h-4 w-4" />, color: 'green' as const },
        { key: 'ratio', label: t('efficiency.regenRatioLabel', 'Regen Ratio'), value: `${fmtNumber((stats.regenRatio ?? 0) * 100)}%`, icon: <TrendingUp className="h-4 w-4" />, color: 'cyan' as const },
        { key: 'co2', label: t('efficiency.co2Label', 'CO₂ Saved'), value: `${fmtInt(stats.co2SavedKg ?? 0)} ${t('efficiency.kgUnit', 'kg')}`, icon: <Leaf className="h-4 w-4" />, color: 'green' as const },
        { key: 'dist', label: t('efficiency.totalDistLabel', 'Total Distance'), value: `${fmtInt(toStatsDistanceDisplay(stats.totalDistanceKm ?? 0))} ${distanceUnit}`, icon: <Route className="h-4 w-4" />, color: 'cyan' as const },
        { key: 'top', label: t('efficiency.topSpeed', 'Top Speed'), value: `${fmtInt(toStatsSpeedDisplay(stats.topSpeedKmh ?? 0))} ${speedUnit}`, icon: <Gauge className="h-4 w-4" />, color: 'purple' as const },
        { key: 'cost', label: t('efficiency.costPerKmLabel', 'Est. Cost/km'), value: `$${costPerKm}`, icon: <Fuel className="h-4 w-4" />, color: 'amber' as const },
      ]
    : [];

  return (
    <PageContainer
      title={t('efficiency.title', 'Efficiency')}
      subtitle={t('efficiency.subtitle', 'Energy consumption and driving efficiency analysis')}
      query={[statsQuery, drivesQuery]}
      dataSources={dataSources}
      actions={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={setRange}
            align="end"
            triggerTestId="efficiency-range"
          />
          <SavedViewMenu
            route="/efficiency"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      {/* ── A · KPI band ─────────────────────────────────────────── */}
      <FadeIn>
        <section aria-label={t('efficiency.section.kpis', 'Key metrics')} className="space-y-3">
          <SectionTitle>{t('efficiency.section.kpis', 'Key Metrics')}</SectionTitle>
          {/* HELP-03. "Efficiency" is the most over-assumed word in the
              product: users read a Wh/km figure as a wall-meter cost and then
              cannot reconcile it with their electricity bill. The definition
              says plainly that charging losses are excluded. */}
          <p
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]"
            data-testid="efficiency-glossary-strip"
          >
            <span>{t('efficiency.glossary.lead', 'Terms on this page:')}</span>
            <GlossaryTerm term="efficiency" />
            <GlossaryTerm term="rated_range" />
            <GlossaryTerm term="phantom_drain" />
          </p>
          {statsLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height={92} className="rounded-xl" />
              ))}
            </div>
          ) : !stats ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: transient — no stats for the selected vehicle/range */ message={t('efficiency.noStats', 'No efficiency data available yet')} />
              {/* HELP-02 — the governed answer for "why is efficiency blank":
                  the selected range almost always contains no completed
                  drives, which is a range problem rather than a data problem. */}
              <EmptyStateGuidanceDetails
                guidanceId="analytics.efficiency"
                className="mx-auto"
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-8">
              <MetricCard label={t('efficiency.avgConsumption', 'Avg Consumption')} value={fmtNumber(toEfficiencyDisplay(stats.avgEfficiencyWhKm ?? 0))} subtitle={efficiencyUnit} icon={<Zap className="h-5 w-5" />} color="amber" />
              <MetricCard label={t('efficiency.efficiencyLabel', 'Efficiency')} value={distancePerKwh} subtitle={`${distanceUnit}/kWh`} icon={<Gauge className="h-5 w-5" />} color="cyan" />
              <MetricCard label={t('efficiency.avgSpeed', 'Avg Speed')} value={fmtNumber(toStatsSpeedDisplay(stats.avgSpeedKmh ?? 0))} subtitle={speedUnit} icon={<TrendingUp className="h-5 w-5" />} color="green" />
              <MetricCard label={t('efficiency.topSpeed', 'Top Speed')} value={fmtInt(toStatsSpeedDisplay(stats.topSpeedKmh ?? 0))} subtitle={speedUnit} icon={<Gauge className="h-5 w-5" />} color="purple" />
              <MetricCard label={t('efficiency.co2Label', 'CO₂ Saved')} value={fmtInt(stats.co2SavedKg ?? 0)} subtitle={t('efficiency.kgUnit', 'kg')} icon={<Leaf className="h-5 w-5" />} color="green" />
              <MetricCard label={t('efficiency.totalDistLabel', 'Total Distance')} value={fmtInt(toStatsDistanceDisplay(stats.totalDistanceKm ?? 0))} subtitle={distanceUnit} icon={<Route className="h-5 w-5" />} color="cyan" />
              <MetricCard label={t('efficiency.costPerKm', 'Est. Cost/km')} value={`$${costPerKm}`} icon={<Fuel className="h-5 w-5" />} color="amber" />
              <MetricCard label={t('efficiency.drivesAnalyzed', 'Drives Analyzed')} value={fmtInt(stats.totalDrives ?? 0)} icon={<Car className="h-5 w-5" />} color="blue" />
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── B · Overview + primary trend ─────────────────────────── */}
      <FadeIn delay={0.1}>
        <section aria-label={t('efficiency.section.overview', 'Overview and trend')} className="space-y-3">
          <SectionTitle>{t('efficiency.section.overview', 'Overview & Trend')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            {/* Hero: gauge + efficiency summary bars */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('efficiency.overview', 'Efficiency Overview')}
              </PanelTitle>
              {statsLoading ? (
                <Skeleton height={260} />
              ) : !stats ? (
                <EmptyState /* no-action: transient — no summary for the selected vehicle/range */ message={t('efficiency.noSummary', 'No efficiency summary available yet')} />
              ) : (
                <div className="space-y-5">
                  <div className="flex justify-center">
                    <LinearGauge
                      value={Math.round(toEfficiencyDisplay(stats.avgEfficiencyWhKm ?? 0))}
                      max={Math.round(toEfficiencyDisplay(EFFICIENCY_GAUGE_MAX_WH_PER_KM))}
                      size={148}
                      label={t('efficiency.avg', 'Avg')}
                      unit={` ${efficiencyUnit}`}
                      color={efficiencyColor(stats.avgEfficiencyWhKm ?? 0)}
                    className="max-w-xs"
                    />
                  </div>
                  <div className="space-y-4">
                    <MetricBar label={t('efficiency.avgConsumption', 'Avg Consumption')} value={toEfficiencyDisplay(stats.avgEfficiencyWhKm ?? 0)} max={toEfficiencyDisplay(EFFICIENCY_GAUGE_MAX_WH_PER_KM)} color="#00f0ff" sublabel={`${fmtNumber(toEfficiencyDisplay(stats.avgEfficiencyWhKm ?? 0))} ${efficiencyUnit}`} />
                    <MetricBar label={t('efficiency.avgSpeed', 'Avg Speed')} value={toStatsSpeedDisplay(stats.avgSpeedKmh ?? 0)} max={150} color="#10b981" sublabel={`${fmtInt(toStatsSpeedDisplay(stats.avgSpeedKmh ?? 0))} ${speedUnit}`} />
                    <MetricBar label={t('efficiency.regenRatio', 'Regen Ratio')} value={(stats.regenRatio ?? 0) * 100} max={100} color="#a855f7" sublabel={`${fmtNumber((stats.regenRatio ?? 0) * 100)}%`} />
                    <MetricBar label={t('efficiency.totalDriveTime', 'Total Drive Time')} value={stats.totalDurationS ?? 0} max={Math.max(stats.totalDurationS ?? 0, 36000)} color="#f59e0b" sublabel={formatDuration(stats.totalDurationS ?? 0, { precision: 1 })} />
                  </div>
                </div>
              )}
            </GlassPanel>

            {/* Primary visual: daily efficiency trend */}
            <div className="xl:col-span-2">
              <ChartContainer
                title={t('efficiency.dailyTrend', { unit: efficiencyUnit, defaultValue: 'Daily Efficiency ({{unit}})' })}
                ariaLabel={t('efficiency.dailyTrend.aria', 'Daily efficiency trend area chart')}
                data={dailyTrend.map((d) => ({ date: d.date, efficiency: d.efficiency }))}
                dataColumns={[
                  { key: 'date', label: t('efficiency.col.date', 'Date') },
                  { key: 'efficiency', label: efficiencyUnit },
                ]}
                height={320}
                loading={drivesLoading}
                empty={dailyTrend.length < 3}
                annotations={{ vehicleId, scope: 'efficiency', chartId: 'efficiency-daily-trend' }}
              >
                {({ annotations: chartAnnotations }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyTrend}>
                      {areaGradient('effGrad', '#00f0ff')}
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                      <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                      <Area {...AREA_DEFAULTS} dataKey="efficiency" stroke="#00f0ff" fill="url(#effGrad)" name={efficiencyUnit} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>
            </div>
          </div>
        </section>
      </FadeIn>

      {/* ── C · Speed & temperature analysis ─────────────────────── */}
      <FadeIn delay={0.2}>
        <section aria-label={t('efficiency.section.analysis', 'Speed and temperature analysis')} className="space-y-3">
          <SectionTitle>{t('efficiency.section.analysis', 'Speed & Temperature Analysis')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3 xl:gap-5">
            <ChartContainer
              title={t('efficiency.speedDist', 'Efficiency by Speed Range')}
              ariaLabel={t('efficiency.speedDist.aria', 'Efficiency by speed-range bar chart')}
              data={speedDist.map((b) => ({ range: b.range, avgEff: b.avgEff }))}
              dataColumns={[
                { key: 'range', label: t('efficiency.col.range', 'Speed range') },
                { key: 'avgEff', label: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}` },
              ]}
              height={260}
              loading={drivesLoading}
              empty={speedDist.length === 0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={speedDist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="avgEff" name={`${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`} radius={[4, 4, 0, 0]}>
                    {speedDist.map((entry, i) => (
                      <Cell key={i} fill={efficiencyColor(entry.avgEff)} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>

            {/* chart-a11y:no-table per-drive scatter cloud — aggregated stats appear in the KPI band + summary above */}
            <ChartContainer
              title={t('efficiency.speedVsEfficiency', 'Speed vs Efficiency')}
              ariaLabel={t('efficiency.speedVsEfficiency.aria', 'Speed versus efficiency scatter plot')}
              height={260}
              loading={drivesLoading}
              empty={speedVsEff.length < 4}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="speed" name={t('efficiency.speed', 'Speed')} unit={` ${speedUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={speedVsEff} fill="#f59e0b" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>

            {/* chart-a11y:no-table per-drive scatter cloud — bucketed temperature table follows in the breakdown band */}
            <ChartContainer
              title={t('efficiency.tempVsEfficiency', 'Temperature vs Efficiency')}
              ariaLabel={t('efficiency.tempVsEfficiency.aria', 'Temperature versus efficiency scatter plot')}
              height={260}
              loading={drivesLoading}
              empty={tempVsEff.length < 4}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="temp" name={t('efficiency.temp', 'Temp')} unit={` ${tempUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="efficiency" name={efficiencyUnit} unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={tempVsEff} fill="#a855f7" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        </section>
      </FadeIn>

      {/* ── D · Breakdown + energy insights ──────────────────────── */}
      <FadeIn delay={0.3}>
        <section aria-label={t('efficiency.section.breakdown', 'Breakdown and insights')} className="space-y-3">
          <SectionTitle>{t('efficiency.section.breakdown', 'Breakdown & Insights')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3 xl:gap-5">
            {/* Temperature-bucketed efficiency table */}
            <GlassPanel className="p-4 sm:p-5 2xl:col-span-2">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('efficiency.tempEfficiency', 'Efficiency by Temperature Range')}
              </PanelTitle>
              {drivesLoading ? (
                <Skeleton height={220} />
              ) : tempBuckets.length === 0 ? (
                <EmptyState /* no-action: transient — not enough per-drive temperature data yet */ message={t('efficiency.noTempData', 'Not enough data for temperature breakdown')} />
              ) : (
                <DataTable
                  tableId="driving:efficiency-temp-buckets"
                  data={tempBuckets}
                  keyExtractor={(b) => b.range}
                  compact
                  pagination
                  columns={[
                    {
                      key: 'range',
                      header: t('efficiency.tempRange', 'Temp Range'),
                      render: (b) => <Text weight="medium" color="primary">{b.range}</Text>,
                    },
                    {
                      key: 'count',
                      header: t('efficiency.drives', 'Drives'),
                      className: 'text-right',
                      render: (b) => <Text color="secondary">{b.count}</Text>,
                    },
                    {
                      key: 'avgEff',
                      header: `${t('efficiency.avg', 'Avg')} ${efficiencyUnit}`,
                      className: 'text-right',
                      render: (b) => (
                        <Text className="tabular-nums" style={{ color: efficiencyColor(b.avgEff) }}>
                          {fmtInt(toEfficiencyDisplay(b.avgEff))}
                        </Text>
                      ),
                    },
                    {
                      key: 'kmPerKwh',
                      header: `${distanceUnit}/kWh`,
                      className: 'text-right',
                      render: (b) => (
                        <Text color="secondary">{b.avgEff > 0 ? fmtNumber(1000 / toEfficiencyDisplay(b.avgEff)) : '—'}</Text>
                      ),
                    },
                    {
                      key: 'totalDist',
                      header: `${t('efficiency.total', 'Total')} ${distanceUnit}`,
                      className: 'text-right',
                      render: (b) => <Text color="secondary">{fmtInt(toDistanceDisplay(b.totalDist))}</Text>,
                    },
                    {
                      key: 'avgSpeed',
                      header: t('efficiency.avgSpeedCol', 'Avg Speed'),
                      className: 'text-right',
                      render: (b) => <Text color="secondary">{fmtInt(toSpeedDisplay(b.avgSpeed))} {speedUnit}</Text>,
                    },
                  ]}
                />
              )}
            </GlassPanel>

            {/* Energy insights */}
            <GlassPanel className="p-4 sm:p-5 2xl:col-span-1">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Leaf className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                {t('efficiency.insights', 'Energy Insights')}
              </PanelTitle>
              {statsLoading ? (
                <Skeleton height={200} />
              ) : !stats ? (
                <EmptyState /* no-action: transient — no energy insights for the selected vehicle/range */ message={t('efficiency.noInsights', 'No energy insights available yet')} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {insights.map((it) => (
                    <MetricCard key={it.key} label={it.label} value={it.value} icon={it.icon} color={it.color} />
                  ))}
                </div>
              )}
            </GlassPanel>
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
