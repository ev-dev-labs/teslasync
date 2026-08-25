import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  Cell,
  ChartTooltip,
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

export interface DriveDnaDistributionRow {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface DriveDnaDistributionBarPlotProps {
  rows: DriveDnaDistributionRow[];
  seriesName: string;
  categoryWidth: number;
  maxBarSize: number;
  /** Accessible label describing the chart for screen readers. */
  ariaLabel?: string;
}

export function DriveDnaDistributionBarPlot({
  rows,
  seriesName,
  categoryWidth,
  maxBarSize,
  ariaLabel,
}: DriveDnaDistributionBarPlotProps) {
  const { t } = useTranslation();
  const effectiveAriaLabel =
    ariaLabel ??
    t('driveDna.distributions.aria', 'Bar chart of drive DNA signal distribution');

  const dataColumns = useMemo<ChartDataColumn[]>(
    () => [
      { key: 'label', label: t('driveDna.distributions.colLabel', 'Signal') },
      { key: 'count', label: t('driveDna.distributions.colCount', 'Count') },
    ],
    [t],
  );
  const chartRows = useMemo(
    () => rows.map(({ label, count }) => ({ label, count })),
    [rows],
  );

  return (
    <EmbeddedChart
      title={t('driveDna.distributions.title', 'Drive DNA Distribution')}
      ariaLabel={effectiveAriaLabel}
      data={chartRows}
      dataColumns={dataColumns}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 10, right: 18, left: 38, bottom: 8 }}
        >
          {chartGrid}
          <XAxis
            type="number"
            allowDecimals={false}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={categoryWidth}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(value) =>
                  t(
                    'driveDna.distributions.emissionValue',
                    '{{value}} emissions',
                    { value: fmtInt(value) },
                  )
                }
              />
            }
          />
          <Bar
            dataKey="count"
            name={seriesName}
            radius={[0, 5, 5, 0]}
            maxBarSize={maxBarSize}
          >
            {rows.map((row) => (
              <Cell key={row.id} fill={row.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </EmbeddedChart>
  );
}
