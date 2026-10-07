import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import {
  departureDaypartLabel,
  departureLocalHour,
} from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastHourDistributionProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastHourDistribution({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastHourDistributionProps) {
  const { t } = useTranslation();
  const seriesName = t(
    'departure.hourDistribution.series',
    'Recorded departures',
  );
  const rows = useMemo(
    () =>
      forecast.localHourDistribution.map((row) => ({
        hour: departureLocalHour(row.hour, locale),
        departures: row.departures,
        share:
          row.share != null ? Math.round(row.share * 1_000) / 10 : null,
      })),
    [forecast.localHourDistribution, locale],
  );
  const ready =
    state.isResolved && !state.error && forecast.totalDepartures > 0;

  return (
    <section data-testid="departure-hour-distribution">
      <ChartContainer
        title={t(
          'departure.hourDistribution.title',
          'Historical local-hour and daypart distribution',
        )}
        subtitle={t(
          'departure.hourDistribution.subtitle',
          'Qualifying drive starts grouped in the vehicle timezone; multiple trips on one day remain separate events.',
        )}
        ariaLabel={t(
          'departure.hourDistribution.aria',
          'Bar chart of recorded departures by local hour with four daypart summaries',
        )}
        ariaDescription={t(
          'departure.hourDistribution.description',
          'Bars count included drive starts rather than unique driving days.',
        )}
        height={410}
        exportable={ready}
        exportFilename="departure-forecast-hour-distribution"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'hour',
            label: t(
              'departure.hourDistribution.column.hour',
              'Local hour',
            ),
          },
          {
            key: 'departures',
            label: t(
              'departure.hourDistribution.column.departures',
              'Recorded departures',
            ),
          },
          {
            key: 'share',
            label: t(
              'departure.hourDistribution.column.share',
              'Share of included departures (%)',
            ),
          },
        ]}
      >
        <DepartureForecastSectionBody
          forecast={forecast}
          state={state}
          className="flex h-full min-h-0 flex-col"
          skeletonHeight={370}
        >
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="hour"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value) => fmtInt(value)}
                    />
                  }
                />
                <Bar
                  dataKey="departures"
                  name={seriesName}
                  fill={CHART_COLORS[0]}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label={t(
              'departure.hourDistribution.daypartsAria',
              'Departure daypart distribution',
            )}
          >
            {forecast.daypartDistribution.map((daypart) => (
              <div
                key={daypart.daypart}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2"
              >
                <Text as="p" variant="caption">
                  {departureDaypartLabel(t, daypart.daypart)}
                </Text>
                <Text as="p" variant="bodySm" className="font-medium">
                  {daypart.share != null
                    ? t(
                        'departure.hourDistribution.daypartValue',
                        '{{departures}} · {{share}}%',
                        {
                          departures: fmtInt(daypart.departures),
                          share: fmtNumber(
                            daypart.share * 100,
                            0,
                            locale,
                          ),
                        },
                      )
                    : '—'}
                </Text>
              </div>
            ))}
          </div>
          <Text as="p" variant="caption" className="mt-2">
            {t(
              'departure.hourDistribution.timezone',
              'All hour and daypart labels use {{timeZone}}.',
              { timeZone },
            )}
          </Text>
        </DepartureForecastSectionBody>
      </ChartContainer>
    </section>
  );
}
