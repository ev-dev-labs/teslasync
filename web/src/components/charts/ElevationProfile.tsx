import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ChartContainer, chartGrid, axisTick, fmt,
  AREA_DEFAULTS, areaGradient,
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

  const elevGain = useMemo(() => {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < data.length; i++) {
      const diff = data[i].elevation - data[i - 1].elevation;
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
  }, [data]);

  const cursorDistance = useMemo(() => {
    if (currentIndex == null || !data[currentIndex]) return undefined;
    return data[currentIndex].distance;
  }, [currentIndex, data]);

  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (state: any) => {
      if (!onClickIndex || !state) return;
      const idx = state.activeTooltipIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < data.length) {
        onClickIndex(data[idx].index);
      }
    },
    [onClickIndex, data],
  );

  if (data.length === 0) {
    return (
      <ChartContainer
        title={t('replay.elevation.title', 'Elevation Profile')}
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
    <ChartContainer
      title={t('replay.elevation.title', 'Elevation Profile')}
      subtitle={`↑ ${elevGain.gain}m  ↓ ${elevGain.loss}m`}
      height={height}
      className={className}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
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
            contentStyle={{ background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
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
              stroke="#00b4d8"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
