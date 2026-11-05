import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

import { EmptyState, Skeleton } from '@/components/feedback';
import { Accordion, Table, HelpTooltip, Caption } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { HeatmapCell, HeatmapLegend } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';

import type { DriveCalendar } from '../../lib/driveCalendar';
import { formatCalendarMonth, getWeekdayLabels } from './labels';
import type { DriveCalendarSectionState } from './types';

const WEEK_GRID = 'grid grid-flow-col auto-cols-[minmax(1.125rem,1fr)] gap-1';

interface DriveCalendarHeatmapProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
  className?: string;
}

/** Responsive Sunday-first activity grid with month and weekday context. */
export function DriveCalendarHeatmap({
  calendar,
  className,
  isLoading,
  error,
  onRetry,
}: DriveCalendarHeatmapProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const weekdayLabels = getWeekdayLabels(t);

  return (
    <div className={className}>
    <LayoutCard title={t('driveCalendar.heatmap.title', 'Selected period')}
      actions={<div className="flex min-w-0 flex-wrap items-center gap-2">
          <HelpTooltip
            size="sm"
            i18nKey="help.driveCalendar.body"
            defaultValue="Each cell is one day in your selected time zone. Four levels rank active days by distance: darker in light mode, lighter in dark mode. Outlined cells are outside the range or before the first returned drive, not proof of no driving. Continuous coverage is unknown. Streaks count consecutive days with at least one drive."
            ariaLabel={t('help.driveCalendar.iconLabel', 'More info about the calendar')}
          />
        {!isLoading && !error && (
          <Caption>
            {t('driveCalendar.heatmap.activeSummary', '{{active}} active days · {{drives}} drives', {
              active: calendar.activeDays,
              drives: calendar.totalDrives,
            })}
          </Caption>
        )}
      </div>}
    >
      <SourceContent
        state={error ? 'error' : isLoading ? 'loading' : calendar.totalDrives === 0 ? 'empty' : 'ready'}
        label={t('driveCalendar.heatmap.title', 'Selected period')}
        emptyMessage={t('driveCalendar.noDrives', 'No drives in the selected period.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
        errorRecovery={{ onRetry }} loadingContent={<Skeleton height={230} />}
        emptyContent={(
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" aria-hidden="true" />}
          message={t('driveCalendar.noDrives', 'No drives in the selected period.')}
          actionTo={{
            label: t('driveCalendar.browseDrives', 'Browse drives'),
            to: '/drives',
          }}
        />
        )}
      >
        <div
          role="group"
          aria-label={t(
            'driveCalendar.heatmap.aria',
            'Daily driving heatmap for the selected period; {{active}} active days and a {{streak}} day end-of-period streak',
            { active: calendar.activeDays, streak: calendar.currentStreak },
          )}
        >
          <div className="overflow-x-auto pb-1">
            <div className="w-full min-w-max">
              <div className="mb-1 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                <span aria-hidden="true" />
                <div className={WEEK_GRID}>
                  {calendar.weeks.map((week, index) => (
                    <Caption key={week.days[0]?.date ?? index} className="whitespace-nowrap">
                      {week.monthKey
                        ? formatCalendarMonth(week.monthKey, unitPrefs.locale)
                        : ''}
                    </Caption>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                <div className="grid grid-rows-7 gap-1">
                  {weekdayLabels.map((label) => (
                    <Caption key={label} className="flex items-center">
                      {label}
                    </Caption>
                  ))}
                </div>
                <div className={WEEK_GRID}>
                  {calendar.weeks.map((week, index) => (
                    <div
                      key={week.days[0]?.date ?? index}
                      className="grid grid-rows-7 gap-1"
                    >
                      {week.days.map((day) => (
                        <HeatmapCell
                          key={day.date}
                          data-date={day.date}
                          level={day.availability === 'observed' ? day.level : null}
                          label={day.availability !== 'observed' ? t(
                            'driveCalendar.heatmap.unavailableCell',
                            '{{date}} · {{reason}}',
                            {
                              date: formatDayKey(day.date, { style: 'long', locale: unitPrefs.locale }),
                              reason: day.availability === 'outside-range'
                                ? t('driveCalendar.heatmap.outsideRange', 'Outside the selected range')
                                : t('driveCalendar.heatmap.beforeFirstDrive', 'Before the first returned drive; coverage unknown'),
                            },
                          ) : t(
                            'driveCalendar.heatmap.cell',
                            '{{date}} · {{distance}} · {{count}} drives',
                            {
                              date: formatDayKey(day.date, {
                                style: 'long',
                                locale: unitPrefs.locale,
                              }),
                              distance: formatDistance(day.distanceM),
                              count: day.drives,
                            },
                          )}
                          className="h-5"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
        <HeatmapLegend
          label={t('driveCalendar.heatmap.legend', 'Driving intensity from less to more')}
          less={t('driveCalendar.less', 'Less')}
          more={t('driveCalendar.more', 'More')}
          unavailable={t('driveCalendar.heatmap.unavailable', 'Outside range / before first drive')}
        />
        <Accordion title={t('card.viewDetails', 'View details')} className="mt-3">
          <Table variant="embedded" aria-label={t('driveCalendar.activity', 'Driving activity')}>
            <thead>
              <tr>
                <th scope="col">{t('common.date', 'Date')}</th>
                <th scope="col">{t('driveCalendar.distance', 'Distance')}</th>
                <th scope="col">{t('driveCalendar.weekdayPattern.drives', 'Drives')}</th>
              </tr>
            </thead>
            <tbody>
              {calendar.days.filter(day => day.availability !== 'outside-range').map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    {formatDayKey(day.date, { style: 'long', locale: unitPrefs.locale })}
                  </th>
                  {day.availability === 'before-first-drive' ? (
                    <td colSpan={2}>{t('driveCalendar.heatmap.beforeFirstDrive', 'Before the first returned drive; coverage unknown')}</td>
                  ) : (
                    <>
                      <td>{formatDistance(day.distanceM)}</td>
                      <td>{day.drives}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Accordion>
      </SourceContent>
    </LayoutCard>
    </div>
  );
}
