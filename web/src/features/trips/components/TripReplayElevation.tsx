import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ChartTooltip, chartGrid, axisTick, AREA_DEFAULTS,
  areaGradient,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { ChartCard } from '@/components/layout';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import { useChartPalette } from '@/hooks/useChartPalette';

export interface TripReplayElevationPoint {
  index: number;
  distance: number;
  elevation: number | null;
  speed: number | null;
}

interface TripReplayElevationProps {
  data: TripReplayElevationPoint[];
  currentIndex: number;
  onClickIndex: (index: number) => void;
  distanceUnit: string;
  height?: number;
}

/** Retain sample indices and gaps: missing altitude is not a sea-level observation. */
export function TripReplayElevation({
  data, currentIndex, onClickIndex, distanceUnit, height = 220,
}: TripReplayElevationProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const palette = useChartPalette();
  const hasElevation = data.some(point => point.elevation != null);
  let gain = 0;
  let loss = 0;
  let hasPair = false;
  for (let i = 1; i < data.length; i++) {
    const previous = data[i - 1].elevation;
    const current = data[i].elevation;
    if (previous == null || current == null) continue;
    hasPair = true;
    const delta = current - previous;
    if (delta > 0) gain += delta;
    else loss -= delta;
  }
  const cursor = data.find(point => point.index === currentIndex);

  return (
    <ChartCard
      title={t('replay.elevation.title', 'Elevation Profile')}
      subtitle={hasPair ? t('replay.elevation.gainLoss', '↑ {{gain}}m  ↓ {{loss}}m', {
        gain: fmtNumber(Math.round(gain)), loss: fmtNumber(Math.round(loss)),
      }) : undefined}
      ariaLabel={t('replay.elevation.title', 'Elevation Profile')}
      height={height}
      size="standard"
      exportable
      data={data.map(({ index, distance, elevation }) => ({ index, distance, elevation }))}
      dataColumns={[
        { key: 'index', label: t('sweetSpot.col.sample', 'Sample') },
        {
          key: 'distance',
          label: `${t('trips.detail.distance', 'Distance')} (${distanceUnit})`,
          format: value => typeof value === 'number' ? fmtNumber(value) : '—',
        },
        {
          key: 'elevation',
          label: `${t('replay.elevation.label', 'Elevation')} (m)`,
          format: value => typeof value === 'number' ? fmtNumber(value) : '—',
        },
      ]}
    >
      {hasElevation ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            className="cursor-pointer"
            onClick={(state: { activeTooltipIndex?: number } | null) => {
              const point = state?.activeTooltipIndex != null ? data[state.activeTooltipIndex] : undefined;
              if (point) onClickIndex(point.index);
            }}
          >
            {areaGradient('replayElevationGrad', palette[0], 0.08)}
            <CartesianGrid {...chartGrid} />
            <XAxis
              dataKey="distance"
              {...axisTick}
              tickFormatter={(value: number) => fmtNumber(value)}
              label={{ value: distanceUnit, position: 'insideBottomRight', offset: -5, style: axisTick }}
            />
            <YAxis
              {...axisTick}
              tickFormatter={(value: number) => fmtNumber(value)}
              label={{ value: 'm', angle: -90, position: 'insideLeft', style: axisTick }}
            />
            <Tooltip
              content={<ChartTooltip />}
              labelFormatter={(value: number) => `${fmtNumber(value)} ${distanceUnit}`}
              formatter={(value: number) => [`${fmtNumber(value)} m`, t('replay.elevation.label', 'Elevation')]}
            />
            <Area
              {...AREA_DEFAULTS}
              dataKey="elevation"
              stroke={palette[0]}
              fill="url(#replayElevationGrad)"
              isAnimationActive={false}
              connectNulls={false}
            />
            {cursor && Number.isFinite(cursor.distance) && (
              <ReferenceLine x={cursor.distance} {...chartTokens.cursor} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState /* no-action: altitude was not observed; seeking cannot recover missing telemetry */
          message={t('replay.elevation.noData', 'No elevation data available')}
        />
      )}
    </ChartCard>
  );
}
