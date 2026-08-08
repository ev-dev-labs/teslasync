import { CalendarRange } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar, Cell, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis, axisTick, chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { TargetBand, WeekResult } from '../../lib/efficiencyTarget';
import type { EfficiencyTargetSectionState } from './types';
import { useEfficiencyTargetDisplay } from './useEfficiencyTargetDisplay';

const MAX_CHART_WEEKS = 26;

interface WeeklyTargetChartProps {
  weeks: WeekResult[];
  targetWhPerKm: number;
  state: EfficiencyTargetSectionState;
}

export function WeeklyTargetChart(
  { weeks, targetWhPerKm, state }: WeeklyTargetChartProps,
) {
  const { t } = useTranslation();
  const { convertEfficiency, efficiencyUnit, formatWeek } =
    useEfficiencyTargetDisplay();
  const consumptionName = t('effTarget.weekly.consumptionSeries', 'Weekly consumption');
  const rollingName = t('effTarget.weekly.rollingSeries', 'Rolling 4-week trend');
  const statusLabel = (band: TargetBand | null, active: boolean) => {
    if (active) return t('effTarget.status.snapshot', 'Active snapshot');
    if (band === 'onTarget') return t('effTarget.status.onTarget', 'On target');
    if (band === 'nearMiss') return t('effTarget.status.nearMiss', 'Near miss');
    if (band === 'offTrack') return t('effTarget.status.offTrack', 'Off track');
    return t('effTarget.status.ungraded', 'Ungraded');
  };
  const rows = useMemo(
    () =>
      weeks.slice(-MAX_CHART_WEEKS).map((week) => ({
        week: formatWeek(week.weekStart),
        weekStart: week.weekStart,
        consumption: Math.round(convertEfficiency(week.whPerKm) * 10) / 10,
        rolling:
          week.rolling4WeekWhPerKm != null
            ? Math.round(
                convertEfficiency(week.rolling4WeekWhPerKm) * 10,
              ) / 10
            : null,
        phase: week.isActive
          ? t('effTarget.weekly.activePhase', 'Active · partial')
          : t('effTarget.weekly.completePhase', 'Completed'),
        status: statusLabel(week.band, week.isActive),
        band: week.band,
        active: week.isActive ? 1 : 0,
      })),
    [convertEfficiency, formatWeek, t, weeks],
  );
  const targetDisplay = Math.round(convertEfficiency(targetWhPerKm) * 10) / 10;
  const barColor = (band: TargetBand | null, active: number) => {
    if (active === 1) return CHART_COLORS[0];
    if (band === 'onTarget') return CHART_COLORS[1];
    if (band === 'nearMiss') return CHART_COLORS[4];
    if (band === 'offTrack') return CHART_COLORS[3];
    return CHART_COLORS[5];
  };

  return (
    <section
      aria-label={t('effTarget.sections.weekly', 'Weekly consumption and rolling trend')}
      data-testid="efficiency-target-weekly"
    >
      <ChartContainer
        title={t('effTarget.weekly.title', 'Weekly consumption vs target')}
        subtitle={t(
          'effTarget.weekly.subtitle',
          'Bars show observed weekly consumption; the line is a trailing four-calendar-week distance-weighted trend.',
        )}
        ariaLabel={t(
          'effTarget.weekly.aria',
          'Weekly consumption bars, target line, and rolling four-week trend with the active partial week distinguished',
        )}
        action={
          <Badge variant="info" dot>
            {t('effTarget.weekly.activeLegend', 'Target {{target}} · active = snapshot', {
              target: `${fmtNumber(targetDisplay, 1)} ${efficiencyUnit}`,
            })}
          </Badge>
        }
        chartKey="efficiency-target-weekly"
        loading={state.isLoading}
        empty={false}
        height={380}
        exportable={!state.error && !state.isLoading && rows.length > 0}
        exportFilename="efficiency-target-weekly"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'week', label: t('effTarget.col.week', 'Week') },
          {
            key: 'consumption',
            label: `${t('effTarget.col.consumption', 'Consumption')} (${efficiencyUnit})`,
          },
          {
            key: 'rolling',
            label: `${t('effTarget.col.rolling', 'Rolling 4-week trend')} (${efficiencyUnit})`,
          },
          { key: 'phase', label: t('effTarget.col.phase', 'Week phase') },
          { key: 'status', label: t('effTarget.col.status', 'Status') },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              className="h-full"
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'effTarget.weekly.empty',
                'No eligible weekly observations are available for this chart.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={rows}
                margin={{ top: 12, right: 8, left: -8, bottom: 0 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="week"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
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
                <ChartLegend verticalAlign="top" align="right" />
                <ReferenceLine
                  y={targetDisplay}
                  stroke={CHART_COLORS[5]}
                  strokeDasharray="6 4"
                  strokeWidth={2}
                />
                <Bar
                  dataKey="consumption"
                  name={consumptionName}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                  hide={hiddenSeries?.isHidden('consumption') ?? false}
                >
                  {rows.map((row) => (
                    <Cell
                      key={row.weekStart}
                      fill={barColor(row.band, row.active)}
                      fillOpacity={row.active === 1 ? 1 : 0.78}
                    />
                  ))}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="rolling"
                  name={rollingName}
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                  hide={hiddenSeries?.isHidden('rolling') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
