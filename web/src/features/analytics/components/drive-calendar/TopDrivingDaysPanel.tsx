import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import {
  Caption,
  GlassPanel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { formatDayKey } from '@/lib/dateFormat';

import type { CalendarDay } from '../../lib/driveCalendar';
import type { DriveCalendarSectionState } from './types';

interface TopDrivingDaysPanelProps extends DriveCalendarSectionState {
  days: CalendarDay[];
  className?: string;
}

/** Ranked highest-distance days from the same 52-week calendar window. */
export function TopDrivingDaysPanel({
  days,
  className,
  isLoading,
  error,
  onRetry,
}: TopDrivingDaysPanelProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();

  return (
    <GlassPanel className={cn('h-full p-4 sm:p-5', className)}>
      <div className="mb-4">
        <PanelTitle className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('driveCalendar.topDays.title', 'Top driving days')}
        </PanelTitle>
        <Caption className="mt-1 block">
          {t(
            'driveCalendar.topDays.subtitle',
            'Highest-distance days in the last 52 weeks',
          )}
        </Caption>
      </div>

      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} height={52} />
          ))}
        </div>
      ) : days.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-8 w-8" aria-hidden="true" />}
          message={t('driveCalendar.topDays.noData', 'No active driving days to rank yet.')}
          actionTo={{
            label: t('driveCalendar.browseDrives', 'Browse drives'),
            to: '/drives',
          }}
        />
      ) : (
        <ol className="space-y-2">
          {days.map((day, index) => (
            <li
              key={day.date}
              className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.025] px-3 py-2.5"
              aria-label={t('driveCalendar.topDays.rank', 'Rank {{rank}}', {
                rank: index + 1,
              })}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <Text weight="semibold" color="primary" mono>
                  {index + 1}
                </Text>
              </div>
              <div className="min-w-0 flex-1">
                <Text weight="semibold" color="primary" className="block truncate">
                  {formatDayKey(day.date, {
                    style: 'long',
                    locale: unitPrefs.locale,
                  })}
                </Text>
                <Caption className="block">
                  {t('driveCalendar.topDays.dayDetails', '{{count}} drives', {
                    count: day.drives,
                  })}
                </Caption>
              </div>
              <MetricValue className="shrink-0 text-lg">
                {formatDistance(day.distanceM, { precision: 1 })}
              </MetricValue>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
