import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

const COUNT_COLOR = '#a78bfa';
const DISTANCE_COLOR = '#22d3ee';

export function ShareCardWeekdayProfile({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const weekdays = [
    t('shareCard.weekday.sunday', 'Sun'),
    t('shareCard.weekday.monday', 'Mon'),
    t('shareCard.weekday.tuesday', 'Tue'),
    t('shareCard.weekday.wednesday', 'Wed'),
    t('shareCard.weekday.thursday', 'Thu'),
    t('shareCard.weekday.friday', 'Fri'),
    t('shareCard.weekday.saturday', 'Sat'),
  ];
  const countSeries = t('shareCard.weekday.countSeries', 'Drive count');
  const distanceSeries = t('shareCard.weekday.distanceSeries', 'Distance');
  const rows = useMemo(
    () => analysis.weekdays.map((bucket) => ({
      weekday: bucket.weekday,
      label: weekdays[bucket.weekday] ?? String(bucket.weekday),
      driveCount: bucket.driveCount,
      distance: bucket.distanceM != null
        ? display.distanceValue(bucket.distanceM)
        : null,
      distanceM: bucket.distanceM,
    })),
    [analysis.weekdays, display, weekdays],
  );
  const exportRows = useMemo(
    () => rows.map((row) => ({
      weekday_index: row.weekday,
      weekday: row.label,
      drive_count: row.driveCount,
      distance_m: row.distanceM,
    })),
    [rows],
  );
  const hasChartEvidence = state.enabled
    && state.hasData
    && analysis.eligibleRows > 0;

  return (
    <section
      data-testid="share-card-weekday-profile"
      aria-label={t('shareCard.weekday.sectionAria', 'Vehicle-timezone weekday activity profile')}
    >
      <ChartContainer
        title={t('shareCard.weekday.title', 'Weekday activity profile')}
        subtitle={t(
          'shareCard.weekday.subtitle',
          'Eligible drives are assigned to weekdays in the configured vehicle timezone.',
        )}
        ariaLabel={t(
          'shareCard.weekday.aria',
          'Drive counts and measured distance by vehicle-local weekday',
        )}
        ariaDescription={t(
          'shareCard.weekday.description',
          'A missing distance bar means distance coverage was absent, not zero.',
        )}
        exportable={hasChartEvidence}
        exportFilename="share-card-weekday-evidence"
        exportData={hasChartEvidence ? exportRows : undefined}
        data={hasChartEvidence ? rows : []}
        dataColumns={[
          { key: 'label', label: t('shareCard.weekday.day', 'Weekday') },
          { key: 'driveCount', label: countSeries },
          {
            key: 'distanceM',
            label: distanceSeries,
            format: (value) => display.formatDistance(
              typeof value === 'number' ? value : null,
            ),
          },
        ]}
        chartKey="share-card-weekday"
        height={330}
      >
        {({ hiddenSeries }) => (
          <ShareCardSectionBody state={state} skeletonHeight={290}>
            {analysis.eligibleRows > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
                >
                  {chartGrid}
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="count"
                    width={42}
                    allowDecimals={false}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="distance"
                    orientation="right"
                    width={52}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={(
                      <ChartTooltip
                        valueFormatter={(value, name) =>
                          name === countSeries
                            ? display.formatNumber(Number(value), 0)
                            : t('shareCard.units.distanceDisplay', '{{value}} {{unit}}', {
                              value: display.formatNumber(Number(value), 1),
                              unit: display.distanceUnit,
                            })}
                      />
                    )}
                  />
                  <ChartLegend />
                  <Bar
                    yAxisId="count"
                    dataKey="driveCount"
                    name={countSeries}
                    fill={COUNT_COLOR}
                    radius={[5, 5, 0, 0]}
                    hide={hiddenSeries?.isHidden('driveCount')}
                  />
                  <Bar
                    yAxisId="distance"
                    dataKey="distance"
                    name={distanceSeries}
                    fill={DISTANCE_COLOR}
                    radius={[5, 5, 0, 0]}
                    hide={hiddenSeries?.isHidden('distance')}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState /* no-action: the shared report is read-only and reflects its fixed evidence scope */
                message={t(
                  'shareCard.weekday.empty',
                  'No eligible drives support a weekday activity profile.',
                )}
              />
            )}
          </ShareCardSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
