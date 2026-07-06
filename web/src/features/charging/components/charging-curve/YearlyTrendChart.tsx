import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import {
  ChartContainer,
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

  // Legend swatches read straight from the same palette as the series so the
  // colors always match the rendered lines/bar (they previously drifted out of
  // sync when the default palette switched to the color-blind-safe set).
  const legend = useMemo(
    () => [
      {
        key: 'avg10to80',
        color: CHART_COLORS[0],
        opacity: 1,
        label: t('charging.curve.avg10to80Line', '10→80% avg'),
      },
      {
        key: 'avg20to80',
        color: CHART_COLORS[2],
        opacity: 1,
        label: t('charging.curve.avg20to80Line', '20→80% avg'),
      },
      {
        key: 'count',
        color: CHART_COLORS[5],
        opacity: 0.3,
        label: t('charging.curve.dcSessions', 'DC Sessions'),
      },
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
      empty={isEmpty}
      data={data}
      dataColumns={dataColumns}
      height={280}
      exportable
      exportFilename="yearly-charging-trend"
    >
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
          <Bar
            yAxisId="count"
            dataKey="count"
            name={t('charging.curve.dcSessions', 'DC Sessions')}
            fill={CHART_COLORS[5]}
            opacity={0.3}
            radius={[4, 4, 0, 0]}
          />
          <Line
            {...AREA_DEFAULTS}
            yAxisId="min"
            dataKey="avg10to80"
            name={t('charging.curve.avg10to80Line', '10→80% avg')}
            stroke={CHART_COLORS[0]}
            dot={{ r: 4, fill: CHART_COLORS[0] }}
            unit=" min"
          />
          <Line
            {...AREA_DEFAULTS}
            yAxisId="min"
            dataKey="avg20to80"
            name={t('charging.curve.avg20to80Line', '20→80% avg')}
            stroke={CHART_COLORS[2]}
            dot={{ r: 4, fill: CHART_COLORS[2] }}
            unit=" min"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap gap-4 px-2">
        {legend.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: item.color, opacity: item.opacity }}
            />
            <Text variant="bodySm">{item.label}</Text>
          </div>
        ))}
      </div>
    </ChartContainer>
  );
}
