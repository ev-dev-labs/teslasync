import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
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

interface YearlyTrendChartProps {
  yearlyTrend: { year: string; avg10to80: number; avg20to80: number; count: number }[];
}

export default function YearlyTrendChart({ yearlyTrend }: YearlyTrendChartProps) {
  const { t } = useTranslation();

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
      data={yearlyTrend}
      dataColumns={[
        { key: 'year', label: t('charging.curve.col.year', 'Year') },
        { key: 'avg10to80', label: t('charging.curve.col.avg10to80', '10→80% avg min') },
        { key: 'avg20to80', label: t('charging.curve.col.avg20to80', '20→80% avg min') },
        { key: 'count', label: t('charging.curve.col.dcSessions', 'DC Sessions') },
      ]}
      height={280}
      exportable
      exportFilename="yearly-charging-trend"
    >
      {yearlyTrend.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart
              data={yearlyTrend}
              margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
            >
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
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span className="inline-block h-2 w-3 rounded-sm bg-[#00f0ff]" />
              {t('charging.curve.avg10to80Line', '10→80% avg')}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span className="inline-block h-2 w-3 rounded-sm bg-purple-500" />
              {t('charging.curve.avg20to80Line', '20→80% avg')}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span className="inline-block h-2 w-3 rounded-sm bg-red-500 opacity-30" />
              {t('charging.curve.dcSessions', 'DC Sessions')}
            </div>
          </div>
        </>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-8 w-8 opacity-20" />}
          message={t('common.noData', 'No data available')}
          className="py-8"
        />
      )}
    </ChartContainer>
  );
}
