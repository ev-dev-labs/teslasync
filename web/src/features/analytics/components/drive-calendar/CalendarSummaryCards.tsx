import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { calendarDayKey, type DriveCalendar } from '../../lib/driveCalendar';
import type { DriveCalendarSectionState } from './types';

interface CalendarSummaryCardsProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
  rangeEnd: string;
  period?: StatPeriod;
}

export function CalendarSummaryCards({
  calendar, rangeEnd, period, isLoading, error, onRetry,
}: CalendarSummaryCardsProps) {
  const { t } = useTranslation();
  const { formatDistance, unitPrefs } = useUnits();
  const known = !isLoading && !error;
  const title = t('driveCalendar.kpis', 'Drive calendar summary metrics');
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'calendar-active-days',
      label: t('driveCalendar.activeDays', 'Active days'),
      rawValue: known ? calendar.activeDays : null,
      context: t('driveCalendar.inRange', 'in the selected period'),
    },
    {
      metricId: 'text', occurrenceId: 'calendar-streak',
      label: rangeEnd < calendarDayKey(new Date())
        ? t('driveCalendar.rangeEndStreak', 'End-of-period streak')
        : t('driveCalendar.currentStreak', 'Current streak'),
      rawValue: known ? t('driveCalendar.days', '{{count}} days', { count: calendar.currentStreak }) : null,
      context: known ? t('driveCalendar.longest', 'longest: {{count}}', { count: calendar.longestStreak }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'calendar-distance',
      label: t('driveCalendar.distance', 'Distance'),
      rawValue: known ? formatDistance(calendar.totalDistanceM) : null,
      context: known ? t('driveCalendar.driveCount', '{{count}} drives', { count: calendar.totalDrives }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'calendar-busiest-day',
      label: t('driveCalendar.busiestDay', 'Busiest day'),
      rawValue: known && calendar.busiestDay ? formatDistance(calendar.busiestDay.distanceM) : null,
      context: known && calendar.busiestDay
        ? formatDayKey(calendar.busiestDay.date, { style: 'short', locale: unitPrefs.locale })
        : undefined,
    },
  ];
  return (
    <StatStrip
      id="drive-calendar-summary" title={title} metrics={metrics}
      period={period ?? {
        kind: 'unknown', label: t('driveCalendar.inRange', 'in the selected period'),
        reason: t('driveCalendar.periodUnavailable', 'Exact observation bounds are unavailable.'),
      }}
      loading={isLoading}
      footer={error ? (
        <SourceContent state="error" label={title} emptyMessage=""
          errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
          errorRecovery={{ onRetry }}>{null}</SourceContent>
      ) : known && calendar.totalDrives === 0 ? (
        <EmptyState className="py-6" icon={<CalendarDays className="h-7 w-7" aria-hidden="true" />}
          message={t('driveCalendar.noDrives', 'No drives in the selected period.')}
          actionTo={{ label: t('driveCalendar.browseDrives', 'Browse drives'), to: '/drives' }} />
      ) : undefined}
    />
  );
}
