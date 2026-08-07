import { useTranslation } from 'react-i18next';
import { CalendarDays, Flame, Route, Trophy } from 'lucide-react';

import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';

import type { DriveCalendar } from '../../lib/driveCalendar';
import type { DriveCalendarSectionState } from './types';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface CalendarSummaryCardsProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
}

/** Existing four-card summary, kept independent from every richer section. */
export function CalendarSummaryCards({
  calendar,
  isLoading,
  error,
  onRetry,
}: CalendarSummaryCardsProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();

  return (
    <section aria-label={t('driveCalendar.kpis', 'Drive calendar summary metrics')}>
      <Grid cols={KPI_COLUMNS} gap={4}>
        {error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={error} onRetry={onRetry} />
          </GlassPanel>
        ) : isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t('driveCalendar.activeDays', 'Active Days')}
              value={calendar.activeDays}
              subtitle={t('driveCalendar.inYear', 'in the last 52 weeks')}
              icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('driveCalendar.currentStreak', 'Current Streak')}
              value={t('driveCalendar.days', '{{count}} days', {
                count: calendar.currentStreak,
              })}
              subtitle={t('driveCalendar.longest', 'longest: {{count}}', {
                count: calendar.longestStreak,
              })}
              icon={<Flame className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('driveCalendar.distance', 'Distance')}
              value={formatDistance(calendar.totalDistanceM, { precision: 0 })}
              subtitle={t('driveCalendar.driveCount', '{{count}} drives', {
                count: calendar.totalDrives,
              })}
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('driveCalendar.busiestDay', 'Busiest Day')}
              value={
                calendar.busiestDay
                  ? formatDistance(calendar.busiestDay.distanceM, { precision: 0 })
                  : '—'
              }
              subtitle={
                calendar.busiestDay
                  ? formatDayKey(calendar.busiestDay.date, {
                      style: 'short',
                      locale: unitPrefs.locale,
                    })
                  : undefined
              }
              icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            {calendar.totalDrives === 0 && (
              <EmptyState
                className="col-span-full py-6"
                icon={<CalendarDays className="h-7 w-7" aria-hidden="true" />}
                message={t('driveCalendar.noDrives', 'No drives in the last year yet.')}
                actionTo={{
                  label: t('driveCalendar.browseDrives', 'Browse drives'),
                  to: '/drives',
                }}
              />
            )}
          </>
        )}
      </Grid>
    </section>
  );
}
