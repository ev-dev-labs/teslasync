import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartLegend, ChartTooltip, EmbeddedChart, type ChartDataRow, useThemeChartPalette } from '@/components/charts';
import { useSpeedProfile } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertSpeedFromSI, convertPowerFromSI, type PowerUnitPref } from '@/lib/unitConversion';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ChartDatum extends ChartDataRow {
  bucket: string;
  frequency: number | null;
  efficiency: number | null;
}

function buildChartData(
  data: ReturnType<typeof useSpeedProfile>['data'],
  toSpeedDisplay: (mps: number) => number,
  powerUnit: PowerUnitPref,
): ChartDatum[] {
  const distribution = safeArray(data?.distribution);
  const completeCounts = distribution.every((b) => knownNumber(b.readings) != null && b.readings >= 0);
  const totalReadings = distribution.reduce((sum, b) => sum + Math.max(knownNumber(b.readings) ?? 0, 0), 0);

  return distribution.map((b) => {
    const label = formatBucketLabel(b.speed_bucket ?? b.speedBucket ?? '', toSpeedDisplay);
    const freq = completeCounts && totalReadings > 0 ? (b.readings / totalReadings) * 100 : null;
    const watts = knownNumber(b.avg_power_w ?? b.avgPowerW);
    const eff = watts == null ? null : convertPowerFromSI(watts, powerUnit);
    return { bucket: label, frequency: freq, efficiency: eff };
  });
}

/** Convert bucket label to user's speed unit, e.g. "20-40" → "32-64" */
function formatBucketLabel(
  bucket: string,
  toSpeedDisplay: (mps: number) => number,
): string {
  const parts = bucket.split('-');
  if (parts.length === 2) {
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    if (!isNaN(lo) && !isNaN(hi)) {
      return `${fmtInt(toSpeedDisplay(lo))}-${fmtInt(toSpeedDisplay(hi))}`;
    }
  }
  // "80+" style bucket
  const num = parseFloat(bucket);
  if (!isNaN(num)) {
    return `${fmtInt(toSpeedDisplay(num))}+`;
  }
  return bucket;
}

/** Find the bucket with the best (lowest avg_power_w) efficiency */
function findSweetSpot(chartData: ChartDatum[]): string {
  const withEff = chartData.filter((d): d is ChartDatum & { efficiency: number } => d.efficiency != null && d.frequency != null && d.frequency > 0);
  if (withEff.length === 0) return '—';
  let best = withEff[0];
  for (const d of withEff) {
    if (d.efficiency < best.efficiency) best = d;
  }
  return best.bucket;
}

export default function SpeedProfileWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtInt, fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const toSpeedDisplay = useCallback((value: number) => convertSpeedFromSI(value, unitPrefs.speed), [unitPrefs.speed]);
  const powerUnit = unitPrefs.power ?? 'kW';
  const palette = useThemeChartPalette();

  const speedUnit = unitPrefs.speed;

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
  const trust = useDataState({
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });

  const chartData = useMemo(
    () => buildChartData(data, toSpeedDisplay, powerUnit),
    [data, toSpeedDisplay, powerUnit, displayPrecision, displayLocale],
  );

  const sweetSpot = useMemo(() => {
    // API provides optimal speed as SI m/s — toSpeedDisplay = convertSpeedFromSI
    // already expects m/s so it can be passed straight through.
    const optimal = knownNumber(data?.optimalSpeedMps);
    if (optimal != null && optimal > 0) {
      return `${fmtInt(toSpeedDisplay(optimal))}`;
    }
    return findSweetSpot(chartData);
  }, [data, chartData, toSpeedDisplay, fmtInt]);

  const peakFreq = useMemo(() => {
    let max = 0;
    for (const d of chartData) {
      if (d.frequency != null && d.frequency > max) max = d.frequency;
    }
    return max;
  }, [chartData]);

  const peakBucket = useMemo(() => {
    const peak = chartData.find((d) => d.frequency === peakFreq);
    return peak?.bucket ?? '—';
  }, [chartData, peakFreq]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.some((d) => (d.frequency != null && d.frequency > 0) || d.efficiency != null);
  const optimalSpeed = knownNumber(data?.optimalSpeedMps);
  const sweetSpotLabel = optimalSpeed != null && optimalSpeed > 0
    ? t('widget.speedProfile.sweetSpot', 'Sweet spot')
    : t('widget.speedProfile.lowestPowerRange', 'Lowest power range');

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        dataState={trust.hasData ? trust : undefined}
        error={trust.fatalError?.message ?? null}
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
              label: t('widget.speedProfile.mostCommon', 'Most common'),
              value: peakBucket,
              unit: speedUnit,
            },
            {
              label: sweetSpotLabel,
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
          label: t('widget.speedProfile.mostCommon', 'Most common'),
          value: peakBucket,
          unit: speedUnit,
        },
        {
          label: t('widget.speedProfile.peakFreq', 'Peak freq'),
          value: chartData.some((d) => d.frequency != null) ? `${fmtNumber(peakFreq)}%` : null,
        },
        {
          label: sweetSpotLabel,
          value: sweetSpot,
          unit: speedUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.speedProfile.title', 'Speed profile')}
      icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      description={t('widget.speedProfile.sampleScope', 'Observed speed samples · average power is not energy efficiency')}
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
          <EmbeddedChart
            height={180}
            mobileHeight={160}
            title={t('widget.speedProfile.title', 'Speed profile')}
            ariaLabel={t(
              'widget.speedProfile.chartAria',
              'Speed frequency and average power by speed range',
            )}
            data={chartData}
            dataColumns={[
              { key: 'bucket', label: `${t('widget.speedProfile.speedRange', 'Speed range')} (${speedUnit})` },
              { key: 'frequency', label: t('widget.speedProfile.frequency', 'Frequency') },
              { key: 'efficiency', label: `${t('widget.speedProfile.averagePower', 'Average power')} (${powerUnit})` },
            ]}
            chartKey="dashboard-speed-profile"
          >
            {({ hiddenSeries }) => (
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
                tickFormatter={(v: number) => `${fmt(v)}%`}
              />
              <YAxis
                yAxisId="eff"
                orientation="right"
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => fmt(v)}
              />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: number, name: string) => {
                  if (name === t('widget.speedProfile.frequency', 'Frequency')) {
                    return [`${fmtNumber(value)}%`, t('widget.speedProfile.frequency', 'Frequency')];
                  }
                  return [`${fmtNumber(value)} ${powerUnit}`, t('widget.speedProfile.averagePower', 'Average power')];
                }}
                cursor={{ fill: 'var(--surface-hover)' }}
              />
              <ChartLegend />
              <Bar
                yAxisId="freq"
                dataKey="frequency"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                fill={palette.series[0]}
                name={t('widget.speedProfile.frequency', 'Frequency')}
                hide={hiddenSeries?.isHidden('frequency')}
              />
              <Line
                yAxisId="eff"
                type="monotone"
                dataKey="efficiency"
                stroke={palette.series[2]}
                strokeWidth={2}
                dot={{ r: 3, fill: palette.series[2] }}
                name={`${t('widget.speedProfile.averagePower', 'Average power')} (${powerUnit})`}
                connectNulls={false}
                hide={hiddenSeries?.isHidden('efficiency')}
              />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
