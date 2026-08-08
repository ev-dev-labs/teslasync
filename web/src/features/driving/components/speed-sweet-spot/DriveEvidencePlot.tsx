import {
  CartesianGrid, ChartLegend, ChartTooltip, CHART_COLORS, ReferenceArea,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
  axisTick,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { SweetSpotBand } from '../../lib/speedSweetSpot';

export interface DriveScatterRow
  extends Record<string, string | number | null> {
  driveId: number;
  date: string;
  speed: number;
  consumption: number;
  distance: number;
  group: string;
}

interface DriveEvidencePlotProps {
  inBand: DriveScatterRow[];
  other: DriveScatterRow[];
  winning: SweetSpotBand | null;
  inBandName: string;
  otherName: string;
  speedName: string;
  consumptionName: string;
  distanceName: string;
  speedUnit: string;
  efficiencyUnit: string;
  distanceUnit: string;
  convertBandSpeed: (speedKph: number) => number;
  isHidden: (key: string) => boolean;
}

export function DriveEvidencePlot({
  inBand, other, winning, inBandName, otherName, speedName, consumptionName,
  distanceName, speedUnit, efficiencyUnit, distanceUnit, convertBandSpeed,
  isHidden,
}: DriveEvidencePlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--glass-border)"
          strokeOpacity={0.4}
        />
        <XAxis
          type="number"
          dataKey="speed"
          name={speedName}
          unit={` ${speedUnit}`}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="number"
          dataKey="consumption"
          name={consumptionName}
          unit={` ${efficiencyUnit}`}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={62}
        />
        <ZAxis
          type="number"
          dataKey="distance"
          name={distanceName}
          range={[45, 220]}
        />
        {winning != null ? (
          <ReferenceArea
            x1={convertBandSpeed(winning.fromKph)}
            x2={convertBandSpeed(winning.toKph)}
            fill={CHART_COLORS[1]}
            fillOpacity={0.09}
            stroke={CHART_COLORS[1]}
            strokeOpacity={0.4}
          />
        ) : null}
        <Tooltip
          content={
            <ChartTooltip
              valueFormatter={(value, name) =>
                name === speedName
                  ? `${fmtNumber(value, 1)} ${speedUnit}`
                  : name === distanceName
                    ? `${fmtNumber(value, 1)} ${distanceUnit}`
                    : `${fmtNumber(value, 1)} ${efficiencyUnit}`
              }
            />
          }
        />
        <ChartLegend verticalAlign="top" align="right" />
        <Scatter
          name={otherName}
          data={other}
          fill={CHART_COLORS[5]}
          fillOpacity={0.58}
          hide={isHidden(otherName)}
        />
        <Scatter
          name={inBandName}
          data={inBand}
          fill={CHART_COLORS[1]}
          fillOpacity={0.85}
          hide={isHidden(inBandName)}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
