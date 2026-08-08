import { CalendarRange } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS, ComposedChart,
  Line, ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { MonthlyColdStartRollup } from '../../lib/coldStart';
import type { ColdStartSectionState } from './types';
import { useColdStartDisplay } from './useColdStartDisplay';

interface MonthlyColdStartChartProps {
  months: MonthlyColdStartRollup[];
  state: ColdStartSectionState;
  className?: string;
}

/** Descriptive monthly weighted-consumption trend with per-group sample bars. */
export function MonthlyColdStartChart({ months, state, className }: MonthlyColdStartChartProps) {
  const { t } = useTranslation();
  const { convertEfficiency, efficiencyUnit, formatMonth } = useColdStartDisplay();
  const rows = useMemo(
    () =>
      months.map((month) => ({
        month: formatMonth(month.month),
        cold:
          month.cold.whPerKm != null
            ? Math.round(convertEfficiency(month.cold.whPerKm) * 10) / 10
            : null,
        warm:
          month.warm.whPerKm != null
            ? Math.round(convertEfficiency(month.warm.whPerKm) * 10) / 10
            : null,
        coldSamples: month.cold.drives,
        warmSamples: month.warm.drives,
      })),
    [convertEfficiency, formatMonth, months],
  );
  const hasData = rows.some((row) => row.cold != null || row.warm != null);
  const coldName = t('coldStart.monthly.coldSeries', 'Cold consumption');
  const warmName = t('coldStart.monthly.warmSeries', 'Warm consumption');
  const coldSamplesName = t('coldStart.monthly.coldSamples', 'Cold samples');
  const warmSamplesName = t('coldStart.monthly.warmSamples', 'Warm samples');

  return (
    <section
      className={className}
      aria-label={t('coldStart.sections.monthly', 'Monthly cold and warm trend')}
      data-testid="cold-start-monthly"
    >
      <ChartContainer
        className="h-full"
        title={t('coldStart.monthly.title', 'Monthly cold vs warm trend')}
        subtitle={t(
          'coldStart.monthly.subtitle',
          'Distance-weighted observations are descriptive by month; only the aggregate 5+ per group supports a penalty claim.',
        )}
        ariaLabel={t(
          'coldStart.monthly.aria',
          'Monthly cold and warm consumption lines with sample-count bars',
        )}
        loading={state.isLoading}
        height={340}
        chartKey="cold-start-monthly"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="cold-start-monthly"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('coldStart.monthly.month', 'Month') },
          {
            key: 'cold',
            label: `${coldName} (${efficiencyUnit})`,
            format: (value) => (typeof value === 'number' ? fmtNumber(value, 1) : '—'),
          },
          {
            key: 'warm',
            label: `${warmName} (${efficiencyUnit})`,
            format: (value) => (typeof value === 'number' ? fmtNumber(value, 1) : '—'),
          },
          {
            key: 'coldSamples',
            label: coldSamplesName,
            format: (value) => fmtInt(value),
          },
          {
            key: 'warmSamples',
            label: warmSamplesName,
            format: (value) => fmtInt(value),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState /* no-action: monthly evidence appears from classified drives in the selected range. */
              className="h-full"
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'coldStart.monthly.empty',
                'No classified cold or warm drives are available for a monthly trend in this window.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 4, left: -12, bottom: 0 }}>
                {chartGrid}
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="efficiency"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => fmtNumber(value, 0)}
                  width={48}
                />
                <YAxis
                  yAxisId="samples"
                  orientation="right"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === coldSamplesName || name === warmSamplesName
                          ? t('coldStart.monthly.sampleValue', '{{count}} drives', {
                              count: typeof value === 'number' ? value : 0,
                            })
                          : `${fmtNumber(value, 1)} ${efficiencyUnit}`
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="samples"
                  dataKey="coldSamples"
                  name={coldSamplesName}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.16}
                  maxBarSize={18}
                  hide={hiddenSeries?.isHidden('coldSamples') ?? false}
                />
                <Bar
                  yAxisId="samples"
                  dataKey="warmSamples"
                  name={warmSamplesName}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.16}
                  maxBarSize={18}
                  hide={hiddenSeries?.isHidden('warmSamples') ?? false}
                />
                <Line
                  yAxisId="efficiency"
                  type="monotone"
                  dataKey="cold"
                  name={coldName}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('cold') ?? false}
                />
                <Line
                  yAxisId="efficiency"
                  type="monotone"
                  dataKey="warm"
                  name={warmName}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('warm') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
