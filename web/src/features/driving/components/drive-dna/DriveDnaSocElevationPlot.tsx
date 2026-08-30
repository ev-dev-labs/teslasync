import { useTranslation } from 'react-i18next';

import {
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  EmbeddedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { DurationUnitPref } from '@/lib/unitConversion';

export interface DriveDnaSocElevationRow {
  elapsed: number;
  soc: number | null;
  elevation: number | null;
}

interface DriveDnaSocElevationPlotProps {
  rows: DriveDnaSocElevationRow[];
  elapsedLabel: string;
  socName: string;
  elevationName: string;
  durationUnit: DurationUnitPref;
  showSoc: boolean;
  showElevation: boolean;
  socHidden: boolean;
  elevationHidden: boolean;
  ariaLabel?: string;
}

export function DriveDnaSocElevationPlot({
  rows,
  elapsedLabel,
  socName,
  elevationName,
  durationUnit,
  showSoc,
  showElevation,
  socHidden,
  elevationHidden,
  ariaLabel,
}: DriveDnaSocElevationPlotProps) {
  const { t } = useTranslation();

  const effectiveAriaLabel =
    ariaLabel ??
    t('driveDna.socElevationAria', 'State of charge and elevation over elapsed drive time');

  // chart-a11y:no-table dense drive-trace time series — tabular fallback impractical
  return (
    <div className="min-h-0 flex-1">
      <EmbeddedChart
        chartKey="drive-dna-soc-elevation"
        title={t('driveDna.socElevationTitle', 'SoC & Elevation')}
        ariaLabel={effectiveAriaLabel}
        fluid
      >
        {({ hiddenSeries }) => (
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
              {showSoc ? (
                <YAxis
                  yAxisId="soc"
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  unit="%"
                />
              ) : null}
              {showElevation ? (
                <YAxis
                  yAxisId="elevation"
                  orientation="right"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  unit=" m"
                />
              ) : null}
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(value) =>
                      `${fmtNumber(value, 2)} ${durationUnit}`
                    }
                    valueFormatter={(value, name) =>
                      name === socName
                        ? `${fmtNumber(value, 1)}%`
                        : `${fmtNumber(value, 0)} m`
                    }
                  />
                }
              />
              <ChartLegend verticalAlign="top" align="right" />
              {showSoc ? (
                <Line
                  yAxisId="soc"
                  type="linear"
                  dataKey="soc"
                  name={socName}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  hide={(hiddenSeries?.isHidden('soc') ?? false) || socHidden}
                />
              ) : null}
              {showElevation ? (
                <Line
                  yAxisId="elevation"
                  type="linear"
                  dataKey="elevation"
                  name={elevationName}
                  stroke={CHART_COLORS[5]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  hide={
                    (hiddenSeries?.isHidden('elevation') ?? false) ||
                    elevationHidden
                  }
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        )}
      </EmbeddedChart>
    </div>
  );
}
