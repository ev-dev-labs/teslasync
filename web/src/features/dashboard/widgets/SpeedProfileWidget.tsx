import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  chartGrid,
  chartMargin,
  axisTick,
  axisTickSm,
  chartAnimation,
  ChartTooltip,
  EmbeddedChart,
  type ChartDataRow,
  useThemeChartPalette,
  useMeasuredAxisWidth,
  measureAxisLabelWidth,
} from '@/components/charts';
import { useSpeedProfile } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useRangeState } from '@/hooks/useRangeState';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ChartDatum extends ChartDataRow {
  bucket: string;
  frequency: number | null;
  sourceIndex: number;
}

export function frequencyAxisWidth(labels: string[], measure: (label: string) => number): number {
  return measureAxisLabelWidth(labels, measure, 35, 12);
}

function mphBucketToMetersPerSecond(value: number): number {
  // Speed bucket labels are emitted by the existing analytics API as mph.
  return value * 0.44704;
}

export function formatBucketLabel(
  bucket: string,
  toSpeedDisplay: (mps: number) => number,
  fmtInteger: (value: number) => string = (value) => String(Math.round(value)),
): string {
  const range = bucket.split('-');
  if (range.length === 2) {
    const lo = Number.parseFloat(range[0]);
    const hi = Number.parseFloat(range[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return `${fmtInteger(toSpeedDisplay(mphBucketToMetersPerSecond(lo)))}–${fmtInteger(toSpeedDisplay(mphBucketToMetersPerSecond(hi)))}`;
    }
  }

  const num = Number.parseFloat(bucket);
  if (Number.isFinite(num)) {
    return `${fmtInteger(toSpeedDisplay(mphBucketToMetersPerSecond(num)))}+`;
  }
  return bucket;
}

function parseBucketRange(bucket: string): [number, number] | null {
  const range = bucket.split('-');
  if (range.length !== 2) return null;
  const lo = Number.parseFloat(range[0]);
  const hi = Number.parseFloat(range[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

export default function SpeedProfileWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { start, end } = useRangeState({ defaultPresetId: '30d' });
  const toSpeedDisplay = useCallback(
    (mps: number) => convertSpeedFromSI(mps, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const palette = useThemeChartPalette();

  const query = useSpeedProfile(
    vid > 0 ? String(vid) : undefined,
    start,
    end,
  );
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState({
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });

  const chartData = useMemo<ChartDatum[]>(() => {
    const distribution = safeArray(data?.distribution);
    const completeCounts = distribution.every(
      (bucket) => knownNumber(bucket.readings) != null && bucket.readings >= 0,
    );
    const totalReadings = distribution.reduce(
      (sum, bucket) => sum + Math.max(knownNumber(bucket.readings) ?? 0, 0),
      0,
    );

    return distribution.map((bucket, index) => {
      const label = formatBucketLabel(
        bucket.speed_bucket ?? bucket.speedBucket ?? '',
        toSpeedDisplay,
        fmtInt,
      );
      const readings = knownNumber(bucket.readings);
      const frequency = completeCounts && totalReadings > 0 && readings != null
        ? (readings / totalReadings) * 100
        : null;
      return {
        bucket: label,
        frequency,
        sourceIndex: index,
      };
    });
  }, [data, toSpeedDisplay, fmtInt]);

  const sweetSpotSourceIndex = useMemo(() => {
    const distribution = safeArray(data?.distribution);
    const optimalMps = knownNumber(data?.optimalSpeedMps);
    if (optimalMps != null && optimalMps > 0) {
      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;
      distribution.forEach((bucket, index) => {
        const range = parseBucketRange(bucket.speed_bucket ?? bucket.speedBucket ?? '');
        if (!range) return;
        const midMps = mphBucketToMetersPerSecond((range[0] + range[1]) / 2);
        const distance = Math.abs(midMps - optimalMps);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      return nearestIndex;
    }

    let lowestIndex = -1;
    let lowestPower = Number.POSITIVE_INFINITY;
    distribution.forEach((bucket, index) => {
      const power = knownNumber(bucket.avg_power_w ?? bucket.avgPowerW);
      const readings = knownNumber(bucket.readings);
      if (power != null && readings != null && readings > 0 && power < lowestPower) {
        lowestPower = power;
        lowestIndex = index;
      }
    });
    return lowestIndex;
  }, [data]);

  const hasData = chartData.some(
    (datum) => datum.frequency != null && datum.frequency > 0,
  );
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const sweetSpot = useMemo(() => {
    const optimal = knownNumber(data?.optimalSpeedMps);
    if (optimal != null && optimal > 0) {
      return `${fmtInt(toSpeedDisplay(optimal))} ${unitPrefs.speed}`;
    }
    const bucket = chartData.find((datum) => datum.sourceIndex === sweetSpotSourceIndex);
    return bucket ? `${bucket.bucket} ${unitPrefs.speed}` : null;
  }, [data, chartData, fmtInt, toSpeedDisplay, unitPrefs.speed, sweetSpotSourceIndex]);

  const frequencyLabels = useMemo(
    () => [0, 25, 50, 75, 100, ...chartData.flatMap((datum) =>
      datum.frequency == null ? [] : [datum.frequency],
    )].map((value) => `${fmtInt(value)}%`),
    [chartData, fmtInt],
  );
  const frequencyAxisWidthPx = useMeasuredAxisWidth({
    labels: frequencyLabels,
    fontSize: isWide ? axisTick.fontSize : axisTickSm.fontSize,
    enabled: !isCompact,
    minWidth: 35,
    padding: 12,
    fallbackCharacterRatio: 0.75,
  });

  const stats: ChartSummaryStat[] = hasData && sweetSpot
    ? [{
        label: t('widget.speedProfile.sweetSpot', 'Sweet spot'),
        value: sweetSpot,
        unit: undefined,
      }]
    : [];

  const handleRefresh = useCallback(() => {
    if (!isFetching) void refetch();
  }, [isFetching, refetch]);

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.speedProfile.title', 'Speed profile')}
        loading={isLoading}
        dataState={trust.hasData ? trust : undefined}
        error={trust.fatalError?.message ?? null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
          emptyIcon={<Activity className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.speedProfile.title', 'Speed profile')}
      icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
        emptyIcon={<Activity className="h-5 w-5" />}
        stats={hasData ? [
          {
            label: t('widget.speedProfile.sweetSpot', 'Sweet spot'),
            value: sweetSpot?.replace(` ${unitPrefs.speed}`, '') ?? '—',
            unit: sweetSpot ? unitPrefs.speed : undefined,
          },
        ] : []}
        chart={
          <EmbeddedChart
            height={180}
            mobileHeight={160}
            title={t('widget.speedProfile.title', 'Speed profile')}
            ariaLabel={t('widget.speedProfile.chartAria', 'Time at speed by speed range')}
            data={chartData}
            dataColumns={[
              { key: 'bucket', label: `${t('widget.speedProfile.speedRange', 'Speed range')} (${unitPrefs.speed})` },
              { key: 'frequency', label: t('widget.speedProfile.frequency', 'Frequency'), format: (value) => value == null ? '—' : `${fmtInt(Number(value))}%` },
            ]}
            chartKey="dashboard-speed-profile"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
                {chartGrid}
                <XAxis
                  dataKey="bucket"
                  tick={isWide ? axisTick : axisTickSm}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={isWide ? axisTick : axisTickSm}
                  tickLine={false}
                  axisLine={false}
                  width={frequencyAxisWidthPx}
                  tickFormatter={(value: number) => `${fmtInt(value)}%`}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  formatter={(value: number) => [
                    `${fmtInt(value)}%`,
                    t('widget.speedProfile.frequency', 'Frequency'),
                  ]}
                  cursor={{ fill: 'var(--surface-hover)' }}
                />
                <Bar
                  dataKey="frequency"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  name={t('widget.speedProfile.frequency', 'Frequency')}
                >
                  {chartData.map((datum) => (
                    <Cell
                      key={`speed-${datum.sourceIndex}`}
                      fill={datum.sourceIndex === sweetSpotSourceIndex ? palette.series[2] : palette.series[0]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
