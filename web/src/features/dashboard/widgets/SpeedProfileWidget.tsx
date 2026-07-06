import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useSpeedProfile } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertSpeedFromSI, convertPowerFromSI } from '@/lib/unitConversion';

/** 1 mph in SI m/s (NIST: 1 mile = 1609.344 m, 1 h = 3600 s → 0.44704). */
const MPH_TO_MPS = 1609.344 / 3600;

interface ChartDatum {
  bucket: string;
  frequency: number;
  efficiency: number;
}

function buildChartData(
  data: ReturnType<typeof useSpeedProfile>['data'],
  toSpeedDisplay: (mps: number) => number,
  toPowerDisplay: (watts: number) => number,
): ChartDatum[] {
  const distribution = data?.distribution ?? [];
  const totalReadings = distribution.reduce((sum, b) => sum + (b.readings ?? 0), 0);

  return distribution.map((b) => {
    const label = formatBucketLabel(b.speed_bucket ?? b.speedBucket ?? '', toSpeedDisplay);
    const freq = totalReadings > 0 ? ((b.readings ?? 0) / totalReadings) * 100 : 0;
    // API delivers avg power as SI watts; convert at the display boundary.
    const eff = toPowerDisplay(b.avg_power_w ?? 0);
    return { bucket: label, frequency: freq, efficiency: eff };
  });
}

/**
 * Convert an mph bucket label to the user's speed unit, e.g. "20-40" → "32-64"
 * in km/h. The speed-profile API emits bucket edges in miles-per-hour
 * (`'0-15'`, `'15-30'`, …, `'75+'`), so each edge is lifted to SI m/s before
 * the display conversion — `toSpeedDisplay` accepts SI m/s only.
 */
function formatBucketLabel(
  bucket: string,
  toSpeedDisplay: (mps: number) => number,
): string {
  const parts = bucket.split('-');
  if (parts.length === 2) {
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    if (!isNaN(lo) && !isNaN(hi)) {
      return `${fmtInt(toSpeedDisplay(lo * MPH_TO_MPS))}-${fmtInt(toSpeedDisplay(hi * MPH_TO_MPS))}`;
    }
  }
  // "75+" style bucket
  const num = parseFloat(bucket);
  if (!isNaN(num)) {
    return `${fmtInt(toSpeedDisplay(num * MPH_TO_MPS))}+`;
  }
  return bucket;
}

/** Find the bucket with the best (lowest avg_power_w) efficiency */
function findSweetSpot(chartData: ChartDatum[]): string {
  const withEff = chartData.filter((d) => d.efficiency > 0);
  if (withEff.length === 0) return '—';
  let best = withEff[0];
  for (const d of withEff) {
    if (d.efficiency < best.efficiency) best = d;
  }
  return best.bucket;
}

export default function SpeedProfileWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  // Stable across renders unless the relevant preference changes, so the
  // derived chart/stat memos below actually cache instead of recomputing
  // every render (they list these converters in their dependency arrays).
  // Both accept SI input: m/s for speed, watts for power.
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toPowerDisplay = useCallback(
    (watts: number) => convertPowerFromSI(watts, unitPrefs.power),
    [unitPrefs.power],
  );

  const speedUnit = unitPrefs.speed;
  const powerUnit = unitPrefs.power;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSpeedProfile(vid > 0 ? String(vid) : undefined);

  // Only blank the whole widget on the INITIAL load failure (no cached data);
  // a transient background-refetch error keeps the last-good chart on screen
  // and is surfaced through the freshness indicator's error state instead
  // (WidgetShell forwards `isError` to <DataFreshness>).
  const blockingError = !data && error ? String(error) : null;

  const chartData = useMemo(
    () => buildChartData(data, toSpeedDisplay, toPowerDisplay),
    [data, toSpeedDisplay, toPowerDisplay],
  );

  const sweetSpot = useMemo(() => {
    // API provides optimal speed as SI m/s — toSpeedDisplay = convertSpeedFromSI
    // already expects m/s so it can be passed straight through.
    const optimal = data?.optimalSpeedMps ?? 0;
    if (optimal > 0) {
      return `${fmtInt(toSpeedDisplay(optimal))}`;
    }
    return findSweetSpot(chartData);
  }, [data, chartData, toSpeedDisplay]);

  const peakFreq = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      if (d.frequency > max) max = d.frequency;
    }
    return max;
  }, [chartData]);

  const peakBucket = useMemo(() => {
    const peak = chartData.find((d) => d.frequency === peakFreq);
    return peak?.bucket ?? '—';
  }, [chartData, peakFreq]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some((d) => d.frequency > 0);

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={blockingError}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
          emptyIcon={<Activity className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.speedProfile.mostCommon', 'Most Common'),
              value: peakBucket,
              unit: speedUnit,
            },
            {
              label: t('widget.speedProfile.sweetSpot', 'Sweet Spot'),
              value: sweetSpot,
              unit: speedUnit,
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + composed chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.speedProfile.mostCommon', 'Most Common'),
          value: peakBucket,
          unit: speedUnit,
        },
        {
          label: t('widget.speedProfile.peakFreq', 'Peak Freq'),
          value: `${fmtNumber(peakFreq, 1)}%`,
        },
        {
          label: t('widget.speedProfile.sweetSpot', 'Sweet Spot'),
          value: sweetSpot,
          unit: speedUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.speedProfile.title', 'Speed Profile')}
      icon={<Activity className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={blockingError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
        emptyIcon={<Activity className="h-5 w-5" />}
        stats={stats}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="bucket"
                tick={tick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="freq"
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={35}
                tickFormatter={(v: number) => `${fmt(v, 0)}%`}
              />
              <YAxis
                yAxisId="eff"
                orientation="right"
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => fmt(v, 0)}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'frequency') {
                    return [`${fmtNumber(value, 1)}%`, t('widget.speedProfile.frequency', 'Frequency')];
                  }
                  return [`${fmtNumber(value, 1)} ${powerUnit}`, t('widget.speedProfile.avgPower', 'Avg Power')];
                }}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar
                yAxisId="freq"
                dataKey="frequency"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                fill="#6366f1"
                name="frequency"
              />
              <Line
                yAxisId="eff"
                type="monotone"
                dataKey="efficiency"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: '#f59e0b' }}
                name="efficiency"
              />
            </ComposedChart>
          </ResponsiveContainer>
        }
      />
    </WidgetShell>
  );
}
