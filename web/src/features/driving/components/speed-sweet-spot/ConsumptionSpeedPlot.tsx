import {
  Bar, ChartLegend, ChartTooltip, CHART_COLORS, ComposedChart, Line,
  ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { SweetSpotBand } from '../../lib/speedSweetSpot';

export interface ConsumptionCurveRow
  extends Record<string, string | number | null> {
  band: string;
  speed: number;
  qualifiedConsumption: number | null;
  unqualifiedConsumption: number | null;
  distance: number;
  drives: number;
  qualification: string;
}

interface ConsumptionSpeedPlotProps {
  rows: ConsumptionCurveRow[];
  winning: SweetSpotBand | null;
  qualifiedName: string;
  unqualifiedName: string;
  distanceName: string;
  speedUnit: string;
  efficiencyUnit: string;
  distanceUnit: string;
  convertBandSpeed: (speedKph: number) => number;
  isHidden: (key: string) => boolean;
}

export function ConsumptionSpeedPlot({
  rows, winning, qualifiedName, unqualifiedName, distanceName, speedUnit,
  efficiencyUnit, distanceUnit, convertBandSpeed, isHidden,
}: ConsumptionSpeedPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={rows}
        margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
      >
        {chartGrid}
        <XAxis
          type="number"
          dataKey="speed"
          domain={['dataMin', 'dataMax']}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          unit={` ${speedUnit}`}
        />
        <YAxis
          yAxisId="consumption"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={58}
          tickFormatter={(value) => fmtNumber(value, 0)}
        />
        <YAxis
          yAxisId="distance"
          orientation="right"
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(value) => fmtNumber(value, 0)}
        />
        <Tooltip
          content={
            <ChartTooltip
              valueFormatter={(value, name) =>
                name === distanceName
                  ? `${fmtNumber(value, 1)} ${distanceUnit}`
                  : `${fmtNumber(value, 1)} ${efficiencyUnit}`
              }
            />
          }
        />
        <ChartLegend verticalAlign="top" align="right" />
        {winning != null ? (
          <ReferenceArea
            yAxisId="consumption"
            x1={convertBandSpeed(winning.fromKph)}
            x2={convertBandSpeed(winning.toKph)}
            fill={CHART_COLORS[1]}
            fillOpacity={0.1}
            stroke={CHART_COLORS[1]}
            strokeOpacity={0.45}
          />
        ) : null}
        <Bar
          yAxisId="distance"
          dataKey="distance"
          name={distanceName}
          fill={CHART_COLORS[4]}
          fillOpacity={0.26}
          radius={[4, 4, 0, 0]}
          hide={isHidden('distance')}
        />
        <Line
          yAxisId="consumption"
          type="monotone"
          dataKey="qualifiedConsumption"
          name={qualifiedName}
          stroke={CHART_COLORS[1]}
          strokeWidth={2.5}
          dot={{ r: 4 }}
          connectNulls
          hide={isHidden('qualifiedConsumption')}
        />
        <Line
          yAxisId="consumption"
          type="linear"
          dataKey="unqualifiedConsumption"
          name={unqualifiedName}
          stroke={CHART_COLORS[5]}
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={{ r: 4 }}
          hide={isHidden('unqualifiedConsumption')}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
