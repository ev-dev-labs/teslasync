import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import {
  ComposedChart,
  Bar,
  Line,
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
  ChartLegend,
  EmbeddedChart,
  type ChartDataRow,
  useThemeChartPalette,
  useMeasuredAxisWidth,
  measureAxisLabelWidth,
} from '@/components/charts';
import { useSpeedProfile } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertSpeedFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useRangeState } from '@/hooks/useRangeState';
import { Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { WidgetBigNumber, WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import type { PackId } from './designPacks/types';
import { EXPERIMENTAL_BAR_RADII } from './designPacks/experimentalLayouts';
import type { WidgetProps } from './types';

const histogramRadii: Record<PackId, [number, number, number, number]> = {
  ...EXPERIMENTAL_BAR_RADII,
  classic: [4, 4, 0, 0],
  v1: [7, 7, 3, 3],
  v2: [8, 8, 4, 4],
  v3: [6, 6, 2, 2],
  v4: [6, 6, 0, 0],
  v5: [4, 4, 0, 0],
  v6: [10, 10, 2, 2],
  v7: [2, 2, 0, 0],
};

interface ChartDatum extends ChartDataRow {
  bucket: string;
  frequency: number | null;
  power: number | null;
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

export default function SpeedProfileWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const packId = usePackPresentation();
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
    config?.timeRange,
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
      const powerW = knownNumber(bucket.avg_power_w ?? bucket.avgPowerW);
      return {
        bucket: label,
        frequency,
        power: powerW == null ? null : convertPowerFromSI(powerW, unitPrefs.power ?? 'kW'),
        sourceIndex: index,
      };
    });
  }, [data, toSpeedDisplay, fmtInt, unitPrefs.power]);

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
  const powerLabels = useMemo(
    () => [0, ...chartData.map(point => point.power)]
      .filter((value): value is number => value != null)
      .map(value => fmtNumber(value)),
    [chartData, fmtNumber],
  );
  const powerAxisWidth = useMeasuredAxisWidth({
    labels: powerLabels, fontSize: isWide ? axisTick.fontSize : axisTickSm.fontSize,
    enabled: !isCompact, minWidth: 40, padding: 20,
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

  const headline = (
    <WidgetBigNumber
      label={t('widget.speedProfile.sweetSpot', 'Sweet spot')}
      value={hasData ? sweetSpot?.replace(` ${unitPrefs.speed}`, '') : null}
      unit={unitPrefs.speed}
      animated={false}
    />
  );
  const empty = (
    <EmptyState /* no-action: the profile requires recorded speed samples; refresh is owned by WidgetShell */
      icon={<Activity className="h-5 w-5" />}
      message={t('widget.speedProfile.noData', 'No speed data')}
    />
  );

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
        <InstrumentPresentation
          family="bars"
          compact
          headline={headline}
          icon={<Activity />}
          instrument={!hasData ? empty : undefined}
        >
          <WidgetChartSummary
            compact
            isEmpty={!hasData}
            emptyMessage={t('widget.speedProfile.noData', 'No speed data')}
            emptyIcon={<Activity className="h-5 w-5" />}
            stats={stats}
            chart={null}
          />
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  const chart = (
    <EmbeddedChart
      className="h-full min-h-0"
      title={t('widget.speedProfile.title', 'Speed profile')}
      ariaLabel={t('widget.speedProfile.chartAria', 'Speed frequency and average power by speed range')}
      data={chartData}
      dataColumns={[
        { key: 'bucket', label: `${t('widget.speedProfile.speedRange', 'Speed range')} (${unitPrefs.speed})` },
        { key: 'frequency', label: t('widget.speedProfile.frequency', 'Frequency'), format: (value) => value == null ? '—' : `${fmtInt(Number(value))}%` },
        { key: 'power', label: `${t('widget.speedProfile.averagePower', 'Average power')} (${unitPrefs.power ?? 'kW'})`, format: value => value == null ? '—' : fmtNumber(Number(value)) },
      ]}
      chartKey="dashboard-speed-profile"
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargin} {...chartAnimation}>
            {chartGrid}
            <XAxis
              dataKey="bucket"
              tick={isWide ? axisTick : axisTickSm}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="frequency"
              tick={isWide ? axisTick : axisTickSm}
              tickLine={false}
              axisLine={false}
              width={frequencyAxisWidthPx}
              tickFormatter={(value: number) => `${fmtInt(value)}%`}
            />
            <YAxis
              yAxisId="power"
              orientation="right"
              tick={isWide ? axisTick : axisTickSm}
              width={powerAxisWidth}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => fmtNumber(value, 0)}
            />
            <Tooltip
              content={<ChartTooltip />}
              formatter={(value: number, name: string | number) => name === t('widget.speedProfile.frequency', 'Frequency')
                ? [`${fmtInt(value)}%`, name]
                : [`${fmtNumber(value)} ${unitPrefs.power ?? 'kW'}`, name]}
              cursor={{ fill: 'var(--surface-hover)' }}
            />
            <ChartLegend />
            <Bar
              yAxisId="frequency"
              dataKey="frequency"
              radius={histogramRadii[packId]}
              maxBarSize={32}
              name={t('widget.speedProfile.frequency', 'Frequency')}
              hide={hiddenSeries?.isHidden('frequency')}
            >
              {chartData.map((datum) => (
                <Cell
                  key={`speed-${datum.sourceIndex}`}
                  fill={datum.sourceIndex === sweetSpotSourceIndex ? palette.series[2] : palette.series[0]}
                />
              ))}
            </Bar>
            <Line
              yAxisId="power"
              dataKey="power"
              name={`${t('widget.speedProfile.averagePower', 'Average power')} (${unitPrefs.power ?? 'kW'})`}
              stroke={palette.series[1]}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              hide={hiddenSeries?.isHidden('power')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </EmbeddedChart>
  );
  const sampleScope = t('widget.speedProfile.sampleScope', 'Observed speed samples · average power is not energy efficiency');
  const details = (
    <div className="min-w-0 space-y-3">
      <Caption as="p">{sampleScope}</Caption>
      <dl aria-label={t('widget.speedProfile.speedRange', 'Speed range')} className="min-w-0 divide-y divide-[var(--border-subtle)]">
        {chartData.map((datum) => (
          <div key={datum.sourceIndex} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
            <Caption as="dt" className="min-w-0 break-words">{datum.bucket} {unitPrefs.speed}</Caption>
            <Text as="dd" variant="bodySm" className="tabular-nums">
              {t('widget.speedProfile.frequency', 'Frequency')}: {datum.frequency == null ? '—' : `${fmtInt(datum.frequency)}%`}
            </Text>
            <Caption as="dd" className="w-full tabular-nums">
              {t('widget.speedProfile.averagePower', 'Average power')}: {datum.power == null ? '—' : `${fmtNumber(datum.power)} ${unitPrefs.power ?? 'kW'}`}
            </Caption>
          </div>
        ))}
      </dl>
    </div>
  );

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
      <InstrumentPresentation
        family="bars"
        headline={headline}
        icon={<Activity />}
        instrument={chartData.length > 0 ? <div className="h-52 min-w-0 @md:h-60">{chart}</div> : empty}
        details={details}
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
          xAxisLabel={sampleScope}
          chart={chart}
        />
      </InstrumentPresentation>
    </WidgetShell>
  );
}
