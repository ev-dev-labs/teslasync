import { useMemo } from 'react';
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
import { convertSpeedFromSI } from '@/lib/unitConversion';

interface ChartDatum {
  bucket: string;
  frequency: number;
  efficiency: number;
}

function buildChartData(
  data: ReturnType<typeof useSpeedProfile>['data'],
  toSpeedDisplay: (mph: number) => number,
): ChartDatum[] {
  const distribution = data?.distribution ?? [];
  const totalReadings = distribution.reduce((sum, b) => sum + (b.readings ?? 0), 0);

  return distribution.map((b) => {
    const label = formatBucketLabel(b.speed_bucket ?? b.speedBucket ?? '', toSpeedDisplay);
    const freq = totalReadings > 0 ? ((b.readings ?? 0) / totalReadings) * 100 : 0;
    const eff = b.avg_power_w ?? b.avgPowerW ?? 0;
    return { bucket: label, frequency: freq, efficiency: eff };
  });
}

/** Convert bucket label to user's speed unit, e.g. "20-40" → "32-64" */
function formatBucketLabel(
  bucket: string,
  toSpeedDisplay: (mph: number) => number,
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
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

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

  const chartData = useMemo(
    () => buildChartData(data, toSpeedDisplay),
    [data, toSpeedDisplay],
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
        error={error ? String(error) : null}
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
      error={error ? String(error) : null}
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
                  return [fmtNumber(value, 1), t('widget.speedProfile.efficiency', 'Wh/mi')];
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
