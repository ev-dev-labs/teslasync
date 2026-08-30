import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  CHART_COLORS,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import type { YearlyTrendPoint } from './types';

interface YearlyTrendChartProps {
  yearlyTrend: YearlyTrendPoint[];
}

export default function YearlyTrendChart({ yearlyTrend }: YearlyTrendChartProps) {
  const { t } = useTranslation();

  // Null-safe: an undefined `yearlyTrend` prop must not throw on `.length`.
  const data = yearlyTrend ?? [];
  const isEmpty = data.length === 0;

  const dataColumns = useMemo(
    () => [
      { key: 'year', label: t('charging.curve.col.year', 'Year') },
      { key: 'avg10to80', label: t('charging.curve.col.avg10to80', '10→80% avg min') },
      { key: 'avg20to80', label: t('charging.curve.col.avg20to80', '20→80% avg min') },
      { key: 'count', label: t('charging.curve.col.dcSessions', 'DC Sessions') },
    ],
    [t],
  );

  return (
    <ChartContainer
      title={t('charging.curve.yearlyTrend', 'Yearly Charging Speed Trend')}
      subtitle={t(
        'charging.curve.yearlyTrendDesc',
        'Average time-to-charge and session count by year',
      )}
      ariaLabel={t(
        'charging.curve.yearlyTrend.aria',
        'Yearly average charge-time and session-count composed chart',
      )}
      chartKey="charging-curve-yearly-trend"
      empty={isEmpty}
      data={data}
      dataColumns={dataColumns}
      height={280}
      exportable
      exportFilename="yearly-charging-trend"
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="year" tick={axisTickSm} />
          <YAxis
            yAxisId="min"
            tick={axisTickSm}
            orientation="left"
            label={{
              value: t('charging.curve.minutes', 'Minutes'),
              angle: -90,
              position: 'insideLeft',
              style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
            }}
          />
          <YAxis
            yAxisId="count"
            tick={axisTickSm}
            orientation="right"
            label={{
              value: t('charging.curve.sessionCount', 'Sessions'),
              angle: 90,
              position: 'insideRight',
              style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
            }}
          />
          <Tooltip content={<ChartTooltip />} />
          <ChartLegend />
          <Bar
            yAxisId="count"
            dataKey="count"
            name={t('charging.curve.dcSessions', 'DC Sessions')}
            fill={CHART_COLORS[5]}
            opacity={0.3}
            radius={[4, 4, 0, 0]}
            hide={hiddenSeries?.isHidden('count')}
          />
          <Line
            {...AREA_DEFAULTS}
            yAxisId="min"
            dataKey="avg10to80"
            name={t('charging.curve.avg10to80Line', '10→80% avg')}
            stroke={CHART_COLORS[0]}
            dot={{ r: 4, fill: CHART_COLORS[0] }}
            unit=" min"
            hide={hiddenSeries?.isHidden('avg10to80')}
          />
          <Line
            {...AREA_DEFAULTS}
            yAxisId="min"
            dataKey="avg20to80"
            name={t('charging.curve.avg20to80Line', '20→80% avg')}
            stroke={CHART_COLORS[2]}
            dot={{ r: 4, fill: CHART_COLORS[2] }}
            unit=" min"
            hide={hiddenSeries?.isHidden('avg20to80')}
          />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
}
