import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartTooltip,
  CHART_COLORS,
  EmbeddedChart,
  type ChartDataColumn,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';

interface ParkingStartRow {
  label: string;
  stints: number;
}

interface ParkingStartBarChartProps {
  rows: ParkingStartRow[];
  seriesName: string;
  colorIndex: 0 | 2;
  interval: number;
  /** Accessible label describing the chart for screen readers. */
  ariaLabel?: string;
}

/** Shared compact bar visual used by both local-time start profiles. */
export function ParkingStartBarChart({
  rows,
  seriesName,
  colorIndex,
  interval,
  ariaLabel,
}: ParkingStartBarChartProps) {
  const { t } = useTranslation();
  const effectiveAriaLabel =
    ariaLabel ??
    t('parking.startBarAria', 'Bar chart of {{series}} patterns', {
      series: seriesName,
    });

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'label', label: t('parking.startBarColTime', 'Time') },
      {
        key: 'stints',
        label: seriesName,
        format: (v) => fmtInt(v as number),
      },
    ],
    [t, seriesName],
  );
  const chartRows = useMemo(
    () => rows.map(({ label, stints }) => ({ label, stints })),
    [rows],
  );

  return (
    <div className="h-36 sm:h-64">
      <EmbeddedChart
        title={seriesName}
        ariaLabel={effectiveAriaLabel}
        data={chartRows}
        dataColumns={dataColumns}
        fluid
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
          >
            {chartGrid}
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              interval={interval}
            />
            <YAxis
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={
                <ChartTooltip valueFormatter={(value) => fmtInt(value)} />
              }
            />
            <Bar
              dataKey="stints"
              name={seriesName}
              fill={CHART_COLORS[colorIndex]}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </EmbeddedChart>
    </div>
  );
}
