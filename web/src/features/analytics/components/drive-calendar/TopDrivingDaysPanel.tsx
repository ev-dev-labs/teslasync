import { useTranslation } from 'react-i18next';
import { Trophy } from 'lucide-react';

import { EmptyState, Skeleton } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import {
  Caption,
  MetricValue,
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
    <div className={cn('h-full', className)}>
    <LayoutCard title={t('driveCalendar.topDays.title', 'Top driving days')}
      description={t(
            'driveCalendar.topDays.subtitle',
            'Highest-distance days in the selected period',
          )}
    >
      <SourceContent
        state={error ? 'error' : isLoading ? 'loading' : days.length === 0 ? 'empty' : 'ready'}
        label={t('driveCalendar.topDays.title', 'Top driving days')}
        emptyMessage={t('driveCalendar.topDays.noData', 'No active driving days to rank yet.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
        errorRecovery={{ onRetry }} loadingContent={(
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} height={52} />
          ))}
        </div>
        )} emptyContent={(
        <EmptyState
          icon={<Trophy className="h-8 w-8" aria-hidden="true" />}
          message={t('driveCalendar.topDays.noData', 'No active driving days to rank yet.')}
          actionTo={{
            label: t('driveCalendar.browseDrives', 'Browse drives'),
            to: '/drives',
          }}
        />
        )}
      >
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
                <Text weight="semibold" color="primary" className="block break-words">
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
                {formatDistance(day.distanceM)}
              </MetricValue>
            </li>
          ))}
        </ol>
      </SourceContent>
    </LayoutCard>
    </div>
  );
}
