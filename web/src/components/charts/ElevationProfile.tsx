import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ChartContainer, chartGrid, axisTick, fmt,
  AREA_DEFAULTS, areaGradient, ChartTooltip,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ElevationDataPoint {
  index: number;
  distance: number;
  elevation: number;
  speed?: number;
}

interface ElevationProfileProps {
  data: ElevationDataPoint[];
  currentIndex?: number;
  onClickIndex?: (index: number) => void;
  height?: number;
  distanceUnit?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ElevationProfile({
  data,
  currentIndex,
  onClickIndex,
  height = 200,
  distanceUnit = 'km',
  className,
}: ElevationProfileProps) {
  const { t } = useTranslation();

  // Null-safe view of the incoming series. A caller whose query has not yet
  // resolved can hand us `undefined` at runtime despite the typed contract;
  // guarding here keeps every downstream `.length` / index read from throwing
  // and routes an absent series to the empty state instead of a hard crash.
  const points = useMemo(() => data ?? [], [data]);

  const elevGain = useMemo(() => {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < points.length; i++) {
      // Elevation can arrive null from sparse telemetry; coerce to 0 so a
      // single missing sample cannot poison the totals with NaN (which would
      // otherwise surface as "↑ NaNm" in the subtitle).
      const diff = (points[i].elevation ?? 0) - (points[i - 1].elevation ?? 0);
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
  }, [points]);

  const cursorDistance = useMemo(() => {
    if (currentIndex == null) return undefined;
    const point = points[currentIndex];
    if (!point) return undefined;
    // Only draw the playhead for a real, finite distance — a null/NaN value
    // would place the <ReferenceLine> at an invalid x and blank the chart.
    return Number.isFinite(point.distance) ? point.distance : undefined;
  }, [currentIndex, points]);

  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state: any) => {
      if (!onClickIndex || !state) return;
      const idx = state.activeTooltipIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < points.length) {
        onClickIndex(points[idx].index);
      }
    },
    [onClickIndex, points],
  );

  if (points.length === 0) {
    return (
      // chart-a11y:no-table empty state — there is no series to tabulate yet
      <ChartContainer
        title={t('replay.elevation.title', 'Elevation Profile')}
        ariaLabel={t('replay.elevation.aria', 'Elevation profile chart — no data available yet')}
        height={height}
        className={className}
      >
        <EmptyState /* no-action: chart cannot meaningfully recover without data — show prose only */
          message={t('replay.elevation.noData', 'No elevation data available')}
        />
      </ChartContainer>
    );
  }

  return (
    // chart-a11y:no-table dense per-sample elevation series along the route — would be unusable as a table for SR users
    <ChartContainer
      title={t('replay.elevation.title', 'Elevation Profile')}
      subtitle={t('replay.elevation.gainLoss', '↑ {{gain}}m  ↓ {{loss}}m', {
        gain: elevGain.gain,
        loss: elevGain.loss,
      })}
      ariaLabel={t('replay.elevation.aria', 'Elevation profile chart along the route, with total gain and loss in meters')}
      height={height}
      className={className}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={points}
          onClick={handleClick}
          className={cn(onClickIndex && 'cursor-pointer')}
        >
          {areaGradient('elevGrad', '#10b981', 0.4)}
          <CartesianGrid {...chartGrid} />
          <XAxis
            dataKey="distance"
            {...axisTick}
            tickFormatter={(v: number) => fmt(v, 1)}
            label={{ value: distanceUnit, position: 'insideBottomRight', offset: -5, style: { fontSize: 10, fill: '#9ca3af' } }}
          />
          <YAxis
            {...axisTick}
            tickFormatter={(v: number) => fmt(v, 0)}
            label={{ value: 'm', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }}
          />
          <Tooltip
            content={<ChartTooltip />}
            labelFormatter={(v: number) => `${fmt(v, 2)} ${distanceUnit}`}
            formatter={(v: number) => [`${fmt(v, 0)} m`, t('replay.elevation.label', 'Elevation')]}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="elevation"
            stroke="#10b981"
            fill="url(#elevGrad)"
            isAnimationActive={false}
          />
          {cursorDistance != null && (
            <ReferenceLine
              x={cursorDistance}
              stroke="var(--theme-primary, #3b82f6)"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
