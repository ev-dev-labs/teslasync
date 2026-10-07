import { CalendarRange } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  CHART_COLORS,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { convertDurationFromSI } from '@/lib/unitConversion';

import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface MonthlyDwellTrendProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}
/** Descriptive observed dwell and stint-count trend by local start month. */
export function MonthlyDwellTrend(
  { summary, state, className }: MonthlyDwellTrendProps,
) {
  const { t } = useTranslation();
  const { locale } = useDateFormat();
  const { unitPrefs } = useUnits();
  const durationUnit = unitPrefs.duration;
  const rows = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return summary.monthly.map((month) => ({
      month: formatter.format(new Date(`${month.month}-15T12:00:00.000Z`)),
      dwell:
        Math.round(
          convertDurationFromSI(month.totalMs / 1_000, durationUnit) * 10,
        ) / 10,
      average:
        Math.round(
          convertDurationFromSI(month.averageMs / 1_000, durationUnit) * 10,
        ) / 10,
      stints: month.stints,
    }));
  }, [durationUnit, locale, summary.monthly]);
  const hasData = rows.length > 0;
  const dwellName = t(
    'parking.monthly.dwellSeries',
    'Observed dwell ({{unit}})',
    { unit: durationUnit },
  );
  const countName = t('parking.monthly.countSeries', 'Stints');

  return (
    <section
      className={className}
      aria-label={t('parking.sections.monthly', 'Monthly parking trend')}
      data-testid="parking-monthly"
    >
      <ChartContainer
        title={t('parking.monthly.title', 'Monthly Dwell & Stint Trend')}
        subtitle={t(
          'parking.monthly.subtitle',
          '{{count}} stints grouped by parking-start month in {{timeZone}}; observed dwell includes right-censored tails.',
          {
            count: summary.stints.length,
            timeZone: summary.coverage.timeZone,
          },
        )}
        ariaLabel={t(
          'parking.monthly.aria',
          'Monthly bars for observed parking dwell with a line for reconstructed stint counts',
        )}
        loading={state.isLoading}
        height={330}
        chartKey="parking-monthly-dwell"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="parking-monthly-dwell"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('parking.monthly.month', 'Month') },
          {
            key: 'dwell',
            label: dwellName,
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'average',
            label: t(
              'parking.monthly.average',
              'Average stint ({{unit}})',
              { unit: durationUnit },
            ),
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'stints',
            label: countName,
            format: (value) => fmtInt(value),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <ParkingSectionBody state={state} className="h-full min-h-0">
            {!hasData ? (
              <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
                className="h-full"
                icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'parking.monthly.empty',
                  'No reconstructed stints are available for a monthly trend.',
                )}
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 12, right: 4, left: -10, bottom: 0 }}
                >
                  {chartGrid}
                  <XAxis
                    dataKey="month"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="dwell"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => fmtNumber(value, 0)}
                    width={46}
                  />
                  <YAxis
                    yAxisId="count"
                    orientation="right"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={34}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        valueFormatter={(value, name) =>
                          name === countName
                            ? fmtInt(value)
                            : `${fmtNumber(value, 1)} ${durationUnit}`
                        }
                      />
                    }
                  />
                  <ChartLegend verticalAlign="top" align="right" />
                  <Bar
                    yAxisId="dwell"
                    dataKey="dwell"
                    name={dwellName}
                    fill={CHART_COLORS[1]}
                    radius={[5, 5, 0, 0]}
                    maxBarSize={44}
                    hide={hiddenSeries?.isHidden('dwell') ?? false}
                  />
                  <Line
                    yAxisId="count"
                    type="monotone"
                    dataKey="stints"
                    name={countName}
                    stroke={CHART_COLORS[4]}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    hide={hiddenSeries?.isHidden('stints') ?? false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ParkingSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
