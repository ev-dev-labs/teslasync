import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CartesianGrid,
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
} from '@/components/charts';
import { Text } from '@/components/ui';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastWeeklyTrendProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastWeeklyTrend({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastWeeklyTrendProps) {
  const { t } = useTranslation();
  const departureName = t(
    'departure.weeklyTrend.departureSeries',
    'Departure events',
  );
  const activeDayName = t(
    'departure.weeklyTrend.activeDaySeries',
    'Active local days',
  );
  const rows = useMemo(
    () =>
      forecast.weeklyTrend.map((week) => ({
        week: formatDayKey(week.weekStartKey, {
          locale,
          style: 'short',
        }),
        departures: week.departures,
        activeDays: week.activeDays,
      })),
    [forecast.weeklyTrend, locale],
  );
  const ready =
    state.isResolved && !state.error && forecast.totalDepartures > 0;

  return (
    <section data-testid="departure-weekly-trend">
      <ChartContainer
        title={t(
          'departure.weeklyTrend.title',
          'Recent weekly departure trend and active-day cadence',
        )}
        subtitle={t(
          'departure.weeklyTrend.subtitle',
          'Monday-based local weeks include zero-event weeks inside the observed returned span.',
        )}
        ariaLabel={t(
          'departure.weeklyTrend.aria',
          'Weekly recorded departure events and active local driving days across the observed vehicle-timezone span',
        )}
        ariaDescription={t(
          'departure.weeklyTrend.description',
          'Bars count drive starts and the line counts distinct local days containing at least one drive start.',
        )}
        height={410}
        chartKey="departure-forecast-weekly-trend"
        exportable={ready}
        exportFilename="departure-forecast-weekly-trend"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'week',
            label: t(
              'departure.weeklyTrend.column.week',
              'Local week starting',
            ),
          },
          {
            key: 'departures',
            label: t(
              'departure.weeklyTrend.column.departures',
              'Departure events',
            ),
          },
          {
            key: 'activeDays',
            label: t(
              'departure.weeklyTrend.column.activeDays',
              'Active local days',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DepartureForecastSectionBody
            forecast={forecast}
            state={state}
            className="flex h-full min-h-0 flex-col"
            skeletonHeight={370}
          >
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="week"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="departures"
                    allowDecimals={false}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="days"
                    orientation="right"
                    domain={[0, 7]}
                    allowDecimals={false}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend verticalAlign="top" align="right" />
                  <Bar
                    yAxisId="departures"
                    dataKey="departures"
                    name={departureName}
                    fill={CHART_COLORS[0]}
                    radius={[3, 3, 0, 0]}
                    hide={
                      hiddenSeries?.isHidden('departures') ?? false
                    }
                  />
                  <Line
                    yAxisId="days"
                    type="monotone"
                    dataKey="activeDays"
                    name={activeDayName}
                    stroke={CHART_COLORS[2]}
                    strokeWidth={2}
                    dot={false}
                    hide={
                      hiddenSeries?.isHidden('activeDays') ?? false
                    }
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <Text as="p" variant="caption" className="mt-3">
              {t(
                'departure.weeklyTrend.summary',
                '{{departures}} departures across {{activeDays}} active days and {{activeWeeks}} active weeks over {{observedWeeks}} observed weeks in {{timeZone}}.',
                {
                  departures: fmtInt(forecast.totalDepartures),
                  activeDays: fmtInt(forecast.activeDays),
                  activeWeeks: fmtInt(forecast.activeWeeks),
                  observedWeeks: fmtNumber(
                    forecast.observedWeeks,
                    1,
                    locale,
                  ),
                  timeZone,
                },
              )}
            </Text>
          </DepartureForecastSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
