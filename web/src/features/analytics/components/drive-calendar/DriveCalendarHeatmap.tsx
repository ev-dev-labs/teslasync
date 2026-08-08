import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { GlassPanel, HelpTooltip, PanelTitle, Caption } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { formatDayKey } from '@/lib/dateFormat';

import type { DriveCalendar } from '../../lib/driveCalendar';
import { formatCalendarMonth, getWeekdayLabels } from './labels';
import type { DriveCalendarSectionState } from './types';

const WEEK_GRID = 'grid grid-cols-[repeat(53,minmax(0,1fr))] gap-1';
const LEVEL_CLASSES = [
  'bg-[var(--surface-2)]',
  'bg-emerald-500/25',
  'bg-emerald-500/45',
  'bg-emerald-500/70',
  'bg-emerald-400',
] as const;

interface DriveCalendarHeatmapProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
}

/** Responsive Sunday-first activity grid with month and weekday context. */
export function DriveCalendarHeatmap({
  calendar,
  isLoading,
  error,
  onRetry,
}: DriveCalendarHeatmapProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const weekdayLabels = getWeekdayLabels(t);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveCalendar.heatmap.title', 'Last 52 Weeks')}
          <HelpTooltip
            size="sm"
            i18nKey="help.driveCalendar.body"
            defaultValue="Each cell is one day; darker means more distance, scaled against your 95th-percentile day so one road trip doesn't flatten the rest. Streaks count consecutive days with at least one drive."
            ariaLabel={t('help.driveCalendar.iconLabel', 'More info about the calendar')}
          />
        </PanelTitle>
        {!isLoading && !error && (
          <Caption>
            {t('driveCalendar.heatmap.activeSummary', '{{active}} active days · {{drives}} drives', {
              active: calendar.activeDays,
              drives: calendar.totalDrives,
            })}
          </Caption>
        )}
      </div>

      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={230} />
      ) : calendar.totalDrives === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-8 w-8" aria-hidden="true" />}
          message={t('driveCalendar.noDrives', 'No drives in the last year yet.')}
          actionTo={{
            label: t('driveCalendar.browseDrives', 'Browse drives'),
            to: '/drives',
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={t(
            'driveCalendar.heatmap.aria',
            'Daily driving heatmap for the last 52 weeks; {{active}} active days and a {{streak}} day current streak',
            { active: calendar.activeDays, streak: calendar.currentStreak },
          )}
        >
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[760px]">
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
                        <div
                          key={day.date}
                          title={t(
                            'driveCalendar.heatmap.cell',
                            '{{date}} · {{distance}} · {{count}} drives',
                            {
                              date: formatDayKey(day.date, {
                                style: 'long',
                                locale: unitPrefs.locale,
                              }),
                              distance: formatDistance(day.distanceM, { precision: 1 }),
                              count: day.drives,
                            },
                          )}
                          className={cn(
                            'aspect-square min-h-2 rounded-[3px] border border-[var(--border-subtle)]',
                            LEVEL_CLASSES[day.level] ?? LEVEL_CLASSES[0],
                          )}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            className="mt-3 flex items-center justify-end gap-1.5"
            aria-label={t('driveCalendar.heatmap.legend', 'Driving intensity from less to more')}
          >
            <Caption>{t('driveCalendar.less', 'Less')}</Caption>
            {LEVEL_CLASSES.map((levelClass, level) => (
              <span
                key={level}
                className={cn(
                  'h-3.5 w-3.5 rounded-[3px] border border-[var(--border-subtle)]',
                  levelClass,
                )}
                aria-hidden="true"
              />
            ))}
            <Caption>{t('driveCalendar.more', 'More')}</Caption>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
