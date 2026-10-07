import { Route } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  CHART_COLORS,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { FsdInsights } from '@/types/fsd';

import { hasAnyMeasuredFsd } from './helpers';
import type { FsdSectionState } from './types';

const DRIVING_DOT = {
  r: 2.75,
  fill: CHART_COLORS[1],
  stroke: 'var(--panel-bg)',
  strokeWidth: 1.5,
} as const;
const DRIVING_ACTIVE_DOT = { r: 5, strokeWidth: 0 } as const;

/**
 * One already-converted row of the distance trend.
 *
 * The index signature keeps the row assignable to `ChartDataRow` /
 * `CsvCellValue`, so the same array feeds the plot, the CSV export, and the
 * screen-reader fallback table without a cast.
 */
export interface FsdDistanceRow {
  [key: string]: string | number | null;
  date: string;
  label: string;
  /**
   * Supervised self-driving distance in the user's display unit, or null when
   * the counter did not report a measurable value for that day. Recharts skips
   * null points, so an unmeasured day renders as a gap rather than a zero bar.
   */
  fsd: number | null;
  /** Observed driving distance in the user's display unit, or null when unknown. */
  driving: number | null;
}

interface FsdDistanceTrendProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * Daily distance trend comparing supervised self-driving against total
 * observed driving.
 *
 * SI meters are converted to the operator's display unit exactly once, here,
 * and reused for the plot, the CSV export, and the screen-reader table.
 * `connectNulls={false}` keeps a day with no observed-driving denominator as a
 * genuine gap instead of interpolating a value telemetry never reported.
 */
export function FsdDistanceTrend({ insights, state }: FsdDistanceTrendProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const unitLabel = unitPrefs.distance;
  const days = useMemo(() => insights?.daily ?? [], [insights]);
  const fsdName = t('fsd.trend.fsdSeries', 'Supervised self-driving');
  const drivingName = t('fsd.trend.drivingSeries', 'Observed driving');

  const rows = useMemo<FsdDistanceRow[]>(
    () =>
      days.map((day) => ({
        date: day.date,
        label: formatDayKey(day.date, { locale: unitPrefs.locale, style: 'short' }),
        fsd:
          day.fsd_distance_m != null
            ? convertDistanceFromSI(day.fsd_distance_m, unitLabel)
            : null,
        driving:
          day.driving_distance_m != null
            ? convertDistanceFromSI(day.driving_distance_m, unitLabel)
            : null,
      })),
    [days, unitLabel, unitPrefs.locale],
  );

  // Gating on measured self-driving values, not on telemetry: a vehicle that
  // reports its odometer all week but never emits the self-driving counter has
  // telemetry and still has nothing to plot.
  const hasData = hasAnyMeasuredFsd(days);
  const blocked = state.noVehicle || Boolean(state.error);
  const formatValue = (value: unknown) =>
    typeof value === 'number'
      ? t('fsd.trend.value', '{{value}} {{unit}}', { value: value.toFixed(1), unit: unitLabel })
      : t('fsd.notReported', 'Not reported');

  return (
    <section
      aria-label={t('fsd.trend.section', 'Supervised self-driving distance trend')}
      data-testid="fsd-distance-trend"
    >
      <ChartContainer
        title={t('fsd.trend.title', 'Distance trend')}
        subtitle={t(
          'fsd.trend.subtitle',
          'Counter movement attributed to each local calendar day in {{timezone}}.',
          { timezone: insights?.period.timezone ?? 'UTC' },
        )}
        ariaLabel={t(
          'fsd.trend.aria',
          'Daily supervised self-driving distance compared with total observed driving distance',
        )}
        loading={state.isLoading && !blocked}
        empty={false}
        height={340}
        chartKey="fsd-distance-trend"
        exportable={!blocked && !state.isLoading && hasData}
        exportFilename="fsd-distance-trend"
        exportData={rows}
        data={blocked ? [] : rows}
        dataColumns={[
          { key: 'label', label: t('fsd.trend.colDay', 'Local day') },
          { key: 'fsd', label: fsdName, format: formatValue },
          { key: 'driving', label: drivingName, format: formatValue },
        ]}
      >
        {({ hiddenSeries }) =>
          state.noVehicle ? (
            <EmptyState
              className="h-full"
              icon={<Route className="h-8 w-8" aria-hidden="true" />}
              message={t('fsd.noVehicle', 'Select a vehicle to see supervised self-driving telemetry.')}
              actionTo={{ label: t('fsd.chooseVehicle', 'Choose a vehicle'), to: '/vehicles' }}
            />
          ) : state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState /* no-action: the vehicle reported no counter telemetry in this window; the period control in the page header is the only lever */
              className="h-full"
              icon={<Route className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'fsd.trend.empty',
                'The supervised self-driving counter did not report a measurable distance in this period.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                {chartGrid}
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  interval="preserveStartEnd"
                />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} />
                <Tooltip content={<ChartTooltip valueFormatter={formatValue} />} />
                <ChartLegend verticalAlign="top" align="right" />
                <Bar
                  dataKey="fsd"
                  name={fsdName}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.55}
                  radius={[4, 4, 0, 0]}
                  hide={hiddenSeries?.isHidden('fsd') ?? false}
                />
                <Line
                  type="monotone"
                  dataKey="driving"
                  name={drivingName}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={DRIVING_DOT}
                  activeDot={DRIVING_ACTIVE_DOT}
                  connectNulls={false}
                  hide={hiddenSeries?.isHidden('driving') ?? false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
