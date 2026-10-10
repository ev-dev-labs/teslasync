import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { OperationalBrief, type StatMetric, type StatPeriod } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDayKey } from '@/lib/dateFormat';
import { calendarDayKey, type DriveCalendar } from '../../lib/driveCalendar';
import type { DriveCalendarSectionState } from './types';

interface CalendarSummaryCardsProps extends DriveCalendarSectionState {
  calendar: DriveCalendar;
  rangeEnd: string;
  period?: StatPeriod;
  retained?: boolean;
}

export function CalendarSummaryCards({
  calendar, rangeEnd, period, retained = false, isLoading, error, onRetry,
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
      metricId: 'duration', occurrenceId: 'calendar-streak',
      label: rangeEnd < calendarDayKey(new Date())
        ? t('driveCalendar.rangeEndStreak', 'End-of-period streak')
        : t('driveCalendar.currentStreak', 'Current streak'),
      rawValue: known ? calendar.currentStreak * 86400 : null,
      display: {
        formatter: raw => ({ value: t('driveCalendar.days', '{{count}} days', { count: raw / 86400 }), unit: '' }),
      },
      context: known ? t('driveCalendar.longest', 'longest: {{count}}', { count: calendar.longestStreak }) : undefined,
    },
    {
      metricId: 'distance', occurrenceId: 'calendar-distance',
      label: t('driveCalendar.distance', 'Distance'),
      rawValue: known ? calendar.totalDistanceM : null,
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
      context: known ? t('driveCalendar.driveCount', '{{count}} drives', { count: calendar.totalDrives }) : undefined,
    },
    {
      metricId: 'distance', occurrenceId: 'calendar-busiest-day',
      label: t('driveCalendar.busiestDay', 'Busiest day'),
      rawValue: known && calendar.busiestDay ? calendar.busiestDay.distanceM : null,
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
      context: known && calendar.busiestDay
        ? formatDayKey(calendar.busiestDay.date, { style: 'short', locale: unitPrefs.locale })
        : undefined,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const sourcePeriod: StatPeriod = period ?? {
    kind: 'unknown', label: t('driveCalendar.inRange', 'in the selected period'),
    reason: t('driveCalendar.periodUnavailable', 'Exact observation bounds are unavailable.'),
  };
  const statusLabel = isLoading
    ? t('driveCalendar.brief.loading', 'Loading drive history')
    : error ? t('driveCalendar.brief.unavailable', 'Drive history unavailable')
      : retained ? t('driveCalendar.brief.retained', 'Retained drive history')
        : t('driveCalendar.brief.returned', 'Returned drive history');
  return (
    <div id="drive-calendar-summary">
      <OperationalBrief
        compact title={title} metrics={operationalMetrics} loading={isLoading}
        eyebrow={t('driveCalendar.title', 'Drive calendar')}
        description={t('driveCalendar.brief.description', 'Activity, streaks, distance, and the busiest day from returned drives in the selected workspace range.')}
        statusLabel={statusLabel} statusTone={error || retained ? 'warning' : 'neutral'}
        scope={<span>{sourcePeriod.label}{sourcePeriod.kind === 'analysis'
          ? ` · ${sourcePeriod.start} – ${sourcePeriod.endExclusive} · ${sourcePeriod.timezone}`
          : null}</span>}
        freshness={<span>{sourcePeriod.kind === 'unknown' ? sourcePeriod.reason : sourcePeriod.provenance}</span>}
        provenance={t('driveCalendar.sourcePeriod', 'Returned drives in the selected workspace range; continuous coverage is unknown.')}
      />
      {error ? (
        <SourceContent state="error" label={title} emptyMessage=""
          errorMessage={t('error.loadFailed', 'Failed to load data')} error={error}
          errorRecovery={{ onRetry }}>{null}</SourceContent>
      ) : known && calendar.totalDrives === 0 ? (
        <EmptyState className="py-6" icon={<CalendarDays className="h-7 w-7" aria-hidden="true" />}
          message={t('driveCalendar.noDrives', 'No drives in the selected period.')}
          actionTo={{ label: t('driveCalendar.browseDrives', 'Browse drives'), to: '/drives' }} />
      ) : null}
    </div>
  );
}
