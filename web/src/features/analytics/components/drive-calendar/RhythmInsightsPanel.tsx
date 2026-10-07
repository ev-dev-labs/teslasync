import { useTranslation } from 'react-i18next';
import {
  CalendarCheck,
  CalendarRange,
  Gauge,
  Route,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

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
import { fmtNumber } from '@/lib/numberFormat';

import type { DriveCalendar } from '../../lib/driveCalendar';
import { formatCalendarMonth, getWeekdayLabels } from './labels';
import type { DriveCalendarSectionState } from './types';

interface RhythmInsightsPanelProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
  className?: string;
}

interface Insight {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
}

/** Compact rhythm summary derived only from the calendar's SI view model. */
export function RhythmInsightsPanel({
  calendar,
  className,
  isLoading,
  error,
  onRetry,
}: RhythmInsightsPanelProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const longWeekdays = getWeekdayLabels(t, true);

  const favorite = calendar.favoriteWeekday;
  const peakMonth = calendar.busiestMonth;
  const insights: Insight[] = [
    {
      label: t('driveCalendar.rhythm.favoriteDay', 'Favorite driving day'),
      value: favorite ? longWeekdays[favorite.day] ?? '—' : '—',
      detail: favorite
        ? t(
            'driveCalendar.rhythm.favoriteDayDetail',
            '{{count}} drives across {{active}} active days',
            { count: favorite.drives, active: favorite.activeDays },
          )
        : '—',
      icon: CalendarCheck,
    },
    {
      label: t('driveCalendar.rhythm.activeRate', 'Calendar activity'),
      value: `${fmtNumber(calendar.activityRate * 100, 0)}%`,
      detail: t(
        'driveCalendar.rhythm.activeRateDetail',
        'of days included at least one drive',
      ),
      icon: Gauge,
    },
    {
      label: t('driveCalendar.rhythm.typicalDay', 'Typical active day'),
      value:
        calendar.averageDistancePerActiveDayM != null
          ? formatDistance(calendar.averageDistancePerActiveDayM, { precision: 1 })
          : '—',
      detail:
        calendar.averageDrivesPerActiveDay != null
          ? t(
              'driveCalendar.rhythm.typicalDayDetail',
              '{{average}} drives on average',
              { average: fmtNumber(calendar.averageDrivesPerActiveDay, 1) },
            )
          : '—',
      icon: Route,
    },
    {
      label: t('driveCalendar.rhythm.weekendShare', 'Weekend distance'),
      value:
        calendar.weekendDistanceShare != null
          ? `${fmtNumber(calendar.weekendDistanceShare * 100, 0)}%`
          : '—',
      detail: t(
        'driveCalendar.rhythm.weekendShareDetail',
        'share of total distance',
      ),
      icon: CalendarRange,
    },
    {
      label: t('driveCalendar.rhythm.peakMonth', 'Peak month'),
      value: peakMonth
        ? formatCalendarMonth(peakMonth.month, unitPrefs.locale, true)
        : '—',
      detail: peakMonth
        ? t(
            'driveCalendar.rhythm.peakMonthDetail',
            '{{distance}} · {{count}} drives',
            {
              distance: formatDistance(peakMonth.distanceM, { precision: 0 }),
              count: peakMonth.drives,
            },
          )
        : '—',
      icon: Sparkles,
    },
  ];

  return (
    <GlassPanel className={cn('h-full p-4 sm:p-5', className)}>
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('driveCalendar.rhythm.title', 'Driving rhythm')}
      </PanelTitle>

      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={280} />
      ) : calendar.totalDrives === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" aria-hidden="true" />}
          message={t('driveCalendar.rhythm.noData', 'No driving rhythm to summarize yet.')}
          actionTo={{
            label: t('driveCalendar.browseDrives', 'Browse drives'),
            to: '/drives',
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {insights.map(({ label, value, detail, icon: Icon }, index) => (
            <div
              key={label}
              className={cn(
                'rounded-xl border border-[var(--border-subtle)] bg-white/[0.025] p-3',
                index === insights.length - 1 && 'col-span-2',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                <Text variant="label">{label}</Text>
              </div>
              <MetricValue className="mt-2 text-xl">{value}</MetricValue>
              <Caption className="mt-0.5 block">{detail}</Caption>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
