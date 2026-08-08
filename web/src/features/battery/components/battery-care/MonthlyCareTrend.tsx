import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
  axisTick, chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { CareScore } from '../../lib/batteryCare';
import type { BatteryCareSectionState } from './types';
interface MonthlyCareTrendProps {
  care: CareScore;
  state: BatteryCareSectionState;
}
const CHART_MARGIN = { top: 12, right: 4, left: -12, bottom: 0 };

/** Six-month descriptive score trend with the supporting monthly sample bars. */
export function MonthlyCareTrend({
  care,
  state,
}: MonthlyCareTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      care.monthly.map((month) => ({
        month: month.month,
        score: month.score,
        sessions: month.sessionsAnalyzed,
        drives: month.drivesAnalyzed,
      })),
    [care.monthly],
  );
  const hasData = rows.some((row) => row.sessions > 0 || row.drives > 0);
  const calibratedMonths = care.monthly.filter((month) => month.scoreReady).length;
  const scoreName = t('batteryCare.trend.score', 'Care index');
  const sessionName = t('batteryCare.trend.sessions', 'Eligible sessions');
  const driveName = t('batteryCare.trend.drives', 'Eligible drives');
  const columns = useMemo(
    () => [
      { key: 'month', label: t('batteryCare.trend.month', 'Month') },
      {
        key: 'score',
        label: scoreName,
        format: (value: unknown) =>
          typeof value === 'number'
            ? t('batteryCare.trend.scoreValue', '{{score}} / 100', { score: fmtInt(value) })
            : '—',
      },
      {
        key: 'sessions',
        label: sessionName,
        format: (value: unknown) => fmtInt(value),
      },
      {
        key: 'drives',
        label: driveName,
        format: (value: unknown) => fmtInt(value),
      },
    ],
    [driveName, scoreName, sessionName, t],
  );

  return (
    <section
      aria-label={t('batteryCare.trend.region', 'Monthly Battery Care trend')}
      data-testid="battery-care-trend"
    >
      <ChartContainer
        title={t('batteryCare.trend.title', 'Monthly care trend')}
        subtitle={t(
          'batteryCare.trend.description',
          'Monthly scores require at least 3 eligible sessions, 3 eligible drives, and 2 classified-energy sessions',
        )}
        ariaLabel={t(
          'batteryCare.trend.aria',
          'Monthly descriptive care index with eligible charging-session and drive sample counts',
        )}
        loading={state.isLoading}
        height={340}
        chartKey="battery-care-monthly"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="battery-care-monthly"
        data={state.error ? [] : rows}
        dataColumns={columns}
        action={
          <Badge variant={calibratedMonths > 0 ? 'success' : 'warning'} dot>
            {t(
              'batteryCare.trend.calibrated',
              '{{count}} calibrated months',
              { count: calibratedMonths },
            )}
          </Badge>
        }
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState
              className="h-full"
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'batteryCare.trend.empty',
                'No eligible charging or drive observations fall inside the displayed monthly window.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={CHART_MARGIN}>
                {chartGrid}
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="score"
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <YAxis
                  yAxisId="samples"
                  orientation="right"
                  allowDecimals={false}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === scoreName
                          ? t(
                              'batteryCare.trend.scoreValue',
                              '{{score}} / 100',
                              { score: fmtNumber(value, 0) },
                            )
                          : t(
                              'batteryCare.trend.sampleValue',
                              '{{count}} samples',
                              {
                                count: typeof value === 'number' ? value : 0,
                              },
                            )
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  yAxisId="samples"
                  dataKey="sessions"
                  name={sessionName}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.18}
                  maxBarSize={18}
                  hide={hiddenSeries?.isHidden('sessions') ?? false}
                />
                <Bar
                  yAxisId="samples"
                  dataKey="drives"
                  name={driveName}
                  fill={CHART_COLORS[5]}
                  fillOpacity={0.18}
                  maxBarSize={18}
                  hide={hiddenSeries?.isHidden('drives') ?? false}
                />
                <Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  name={scoreName}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('score') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
