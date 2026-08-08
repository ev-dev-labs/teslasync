import { CalendarRange } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, axisTick, chartGrid,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import type { SweetSpotResult } from '../../lib/speedSweetSpot';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface MonthlyOperatingContextProps {
  summary: SweetSpotResult;
  state: SpeedSweetSpotSectionState;
}

export function MonthlyOperatingContext({
  summary,
  state,
}: MonthlyOperatingContextProps) {
  const { t } = useTranslation();
  const {
    convertDistance, convertDriveSpeed, convertEfficiency, distanceUnit,
    efficiencyUnit, formatMonth, speedUnit,
  } = useSpeedSweetSpotDisplay();
  const consumptionName = t(
    'sweetSpot.monthly.consumptionSeries',
    'Weighted consumption',
  );
  const speedName = t(
    'sweetSpot.monthly.speedSeries',
    'Aggregate average speed',
  );
  const rows = useMemo(
    () =>
      summary.monthly.map((month) => {
        const label = formatMonth(month.month);
        return {
          month: t('sweetSpot.monthly.tick', '{{month}} · {{count}}', {
            month: label,
            count: month.drives,
          }),
          monthKey: month.month,
          sample: t('sweetSpot.monthly.sample', '{{count}} drives', {
            count: month.drives,
          }),
          drives: month.drives,
          consumption:
            Math.round(convertEfficiency(month.whPerKm) * 10) / 10,
          speed: Math.round(convertDriveSpeed(month.avgSpeedMps) * 10) / 10,
          distance: Math.round(convertDistance(month.distanceM) * 10) / 10,
        };
      }),
    [
      convertDistance, convertDriveSpeed, convertEfficiency, formatMonth,
      summary.monthly, t,
    ],
  );

  return (
    <section
      aria-label={t(
        'sweetSpot.sections.monthly',
        'Monthly operating context',
      )}
      data-testid="speed-sweet-spot-monthly"
    >
      <ChartContainer
        title={t('sweetSpot.monthly.title', 'Monthly operating context')}
        subtitle={t(
          'sweetSpot.monthly.subtitle',
          'Monthly speed is total distance ÷ total duration and consumption is distance-weighted; co-movement is not evidence that speed caused the change.',
        )}
        ariaLabel={t(
          'sweetSpot.monthly.aria',
          'Monthly distance-weighted consumption and aggregate whole-drive average speed with drive counts',
        )}
        action={
          <Badge variant="neutral" dot>
            {t('sweetSpot.monthly.monthCount', '{{count}} observed months', {
              count: rows.length,
            })}
          </Badge>
        }
        chartKey="speed-sweet-spot-monthly"
        loading={state.isLoading}
        empty={false}
        height={360}
        exportable={!state.error && !state.isLoading && rows.length > 0}
        exportFilename="speed-sweet-spot-monthly"
        exportData={rows}
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'month', label: t('sweetSpot.col.month', 'Month and sample') },
          { key: 'sample', label: t('sweetSpot.col.sample', 'Sample') },
          {
            key: 'consumption',
            label: `${consumptionName} (${efficiencyUnit})`,
          },
          { key: 'speed', label: `${speedName} (${speedUnit})` },
          {
            key: 'distance',
            label: `${t('sweetSpot.col.distance', 'Distance')} (${distanceUnit})`,
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState /* no-action: monthly context depends on valid drive dates. */
              className="h-full"
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sweetSpot.monthly.empty',
                'No eligible drives with valid dates are available for monthly context.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={{ top: 12, right: 10, left: 0, bottom: 4 }}
              >
                {chartGrid}
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={18}
                />
                <YAxis
                  yAxisId="consumption"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  tickFormatter={(value) => fmtNumber(value, 0)}
                />
                <YAxis
                  yAxisId="speed"
                  orientation="right"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(value) => fmtNumber(value, 0)}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === speedName
                          ? `${fmtNumber(value, 1)} ${speedUnit}`
                          : `${fmtNumber(value, 1)} ${efficiencyUnit}`
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Line
                  yAxisId="consumption"
                  type="monotone"
                  dataKey="consumption"
                  name={consumptionName}
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  hide={hiddenSeries?.isHidden('consumption') ?? false}
                />
                <Line
                  yAxisId="speed"
                  type="monotone"
                  dataKey="speed"
                  name={speedName}
                  stroke={CHART_COLORS[4]}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  hide={hiddenSeries?.isHidden('speed') ?? false}
                />
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
