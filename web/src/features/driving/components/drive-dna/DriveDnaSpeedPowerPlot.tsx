import {
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  DurationUnitPref,
  PowerUnitPref,
  SpeedUnitPref,
} from '@/lib/unitConversion';

export interface DriveDnaSpeedPowerRow {
  elapsed: number;
  speed: number | null;
  power: number | null;
}

interface DriveDnaSpeedPowerPlotProps {
  rows: DriveDnaSpeedPowerRow[];
  elapsedLabel: string;
  speedLabel: string;
  powerLabel: string;
  speedName: string;
  powerName: string;
  durationUnit: DurationUnitPref;
  speedUnit: SpeedUnitPref;
  powerUnit: PowerUnitPref;
  showSpeed: boolean;
  showPower: boolean;
  speedHidden: boolean;
  powerHidden: boolean;
}

export function DriveDnaSpeedPowerPlot({
  rows,
  elapsedLabel,
  speedLabel,
  powerLabel,
  speedName,
  powerName,
  durationUnit,
  speedUnit,
  powerUnit,
  showSpeed,
  showPower,
  speedHidden,
  powerHidden,
}: DriveDnaSpeedPowerPlotProps) {
  return (
    <div className="min-h-0 flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 16, right: 28, left: 18, bottom: 24 }}
        >
          {chartGrid}
          <XAxis
            type="number"
            dataKey="elapsed"
            domain={['dataMin', 'dataMax']}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            label={{
              value: elapsedLabel,
              position: 'insideBottom',
              offset: -12,
            }}
          />
          {showSpeed ? (
            <YAxis
              yAxisId="speed"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={64}
              label={{
                value: speedLabel,
                angle: -90,
                position: 'insideLeft',
              }}
            />
          ) : null}
          {showPower ? (
            <YAxis
              yAxisId="power"
              orientation="right"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={68}
              label={{
                value: powerLabel,
                angle: 90,
                position: 'insideRight',
              }}
            />
          ) : null}
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={(value) =>
                  `${fmtNumber(value, 2)} ${durationUnit}`
                }
                valueFormatter={(value, name) =>
                  name === speedName
                    ? `${fmtNumber(value, 1)} ${speedUnit}`
                    : `${fmtNumber(value, 1)} ${powerUnit}`
                }
              />
            }
          />
          <ChartLegend verticalAlign="top" align="right" />
          {showPower ? (
            <ReferenceLine
              yAxisId="power"
              y={0}
              stroke={CHART_COLORS[4]}
              strokeDasharray="4 4"
            />
          ) : null}
          {showSpeed ? (
            <Line
              yAxisId="speed"
              type="linear"
              dataKey="speed"
              name={speedName}
              stroke={CHART_COLORS[0]}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
              hide={speedHidden}
            />
          ) : null}
          {showPower ? (
            <Line
              yAxisId="power"
              type="linear"
              dataKey="power"
              name={powerName}
              stroke={CHART_COLORS[3]}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              hide={powerHidden}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
