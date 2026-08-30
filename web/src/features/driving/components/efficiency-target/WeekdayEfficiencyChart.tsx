import { CalendarDays } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  Cell,
  ChartContainer,
  ChartTooltip,
  CHART_COLORS,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';

import type { WeekdayResult } from '../../lib/efficiencyTarget';
import type { EfficiencyTargetSectionState } from './types';
import { useEfficiencyTargetDisplay } from './useEfficiencyTargetDisplay';

const WEEKDAYS = [
  ['effTarget.weekday.monday', 'Monday'],
  ['effTarget.weekday.tuesday', 'Tuesday'],
  ['effTarget.weekday.wednesday', 'Wednesday'],
  ['effTarget.weekday.thursday', 'Thursday'],
  ['effTarget.weekday.friday', 'Friday'],
  ['effTarget.weekday.saturday', 'Saturday'],
  ['effTarget.weekday.sunday', 'Sunday'],
] as const;

interface WeekdayEfficiencyChartProps {
  weekdays: WeekdayResult[];
  targetWhPerKm: number;
  state: EfficiencyTargetSectionState;
  className?: string;
}

export function WeekdayEfficiencyChart({
  weekdays,
  targetWhPerKm,
  state,
  className,
}: WeekdayEfficiencyChartProps) {
  const { t } = useTranslation();
  const {
    convertEfficiency,
    efficiencyUnit,
    formatDistance,
  } = useEfficiencyTargetDisplay();
  const rows = useMemo(
    () =>
      weekdays.map((weekday) => ({
        day: t(
          WEEKDAYS[weekday.weekday]?.[0] ?? 'effTarget.weekday.unknown',
          WEEKDAYS[weekday.weekday]?.[1] ?? '—',
        ),
        consumption:
          weekday.whPerKm != null
            ? Math.round(convertEfficiency(weekday.whPerKm) * 10) / 10
            : null,
        distanceM: weekday.distanceM,
        drives: weekday.drives,
      })),
    [convertEfficiency, t, weekdays],
  );
  const hasData = rows.some((row) => row.consumption != null);
  const targetDisplay =
    Math.round(convertEfficiency(targetWhPerKm) * 10) / 10;

  return (
    <section
      className={className}
      aria-label={t(
        'effTarget.sections.weekday',
        'Weekday efficiency pattern',
      )}
      data-testid="efficiency-target-weekday"
    >
      <ChartContainer
        className="h-full"
        title={t('effTarget.weekday.title', 'Weekday efficiency pattern')}
        subtitle={t(
          'effTarget.weekday.subtitle',
          'Each day uses distance-weighted eligible drives from the observed history window.',
        )}
        ariaLabel={t(
          'effTarget.weekday.aria',
          'Distance-weighted consumption by weekday with target reference',
        )}
        loading={state.isLoading}
        empty={false}
        height={360}
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="efficiency-target-weekday"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'day', label: t('effTarget.col.weekday', 'Weekday') },
          {
            key: 'consumption',
            label: `${t(
              'effTarget.col.consumption',
              'Consumption',
            )} (${efficiencyUnit})`,
          },
          {
            key: 'distanceM',
            label: t('effTarget.col.distance', 'Distance'),
            format: (value) =>
              typeof value === 'number' ? formatDistance(value) : '—',
          },
          { key: 'drives', label: t('effTarget.col.drives', 'Drives') },
        ]}
      >
        {state.error ? (
          <div className="flex h-full items-center justify-center">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </div>
        ) : !hasData ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="h-full"
            icon={<CalendarDays className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'effTarget.weekday.empty',
              'No eligible drives are available for a weekday pattern.',
            )}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 12, right: 4, left: -8, bottom: 0 }}
            >
              {chartGrid}
              <XAxis
                dataKey="day"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value) => fmtNumber(value, 0)}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    valueFormatter={(value) =>
                      `${fmtNumber(value, 1)} ${efficiencyUnit}`
                    }
                  />
                }
              />
              <ReferenceLine
                y={targetDisplay}
                stroke={CHART_COLORS[5]}
                strokeDasharray="6 4"
              />
              <Bar
                dataKey="consumption"
                name={t(
                  'effTarget.weekday.consumptionSeries',
                  'Observed consumption',
                )}
                radius={[4, 4, 0, 0]}
                maxBarSize={42}
              >
                {rows.map((row, index) => (
                  <Cell
                    key={row.day}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                    fillOpacity={0.78}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </section>
  );
}
