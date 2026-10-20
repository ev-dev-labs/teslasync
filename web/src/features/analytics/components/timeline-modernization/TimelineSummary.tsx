import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';
import { getErrorMessage } from '@/lib/errorMessage';
import { TimelineSource, type TimelineSourceFacts } from './TimelineSource';

interface TimelineSummaryProps {
  source: TimelineSourceFacts;
  period: StatPeriod;
  totalTransitions: number;
  drivingTime: string;
  chargingTime: string;
  idleSleepTime: string;
}

export function TimelineSummary({
  source, period, totalTransitions, drivingTime, chargingTime, idleSleepTime,
}: TimelineSummaryProps) {
  const { t } = useTranslation();
  // Keep the existing specialist rounding contract. The generic roundedMinutes
  // formatter splits before rounding and is not equivalent at 3599/7199 seconds.
  // Source seconds and all bucket arithmetic remain untouched in the page.
  const metrics: StatMetric[] = [
      {
        metricId: 'count', occurrenceId: 'timeline-total-transitions',
        label: t('timeline.totalTransitions', 'Total transitions'),
        description: t('timeline.summary.transitionDescription', 'Sum of transition counts returned by the state summary for this window'),
        rawValue: source.available ? totalTransitions : null,
      },
      {
        metricId: 'text', occurrenceId: 'timeline-driving-time',
        label: t('timeline.drivingTime', 'Driving time'),
        description: t('timeline.summary.drivingDescription', 'Time in the driving state, rounded to whole minutes'),
        rawValue: source.available ? drivingTime : null,
      },
      {
        metricId: 'text', occurrenceId: 'timeline-charging-time',
        label: t('timeline.chargingTime', 'Charging time'),
        description: t('timeline.summary.chargingDescription', 'Time in the charging state, rounded to whole minutes'),
        rawValue: source.available ? chargingTime : null,
      },
      {
        metricId: 'text', occurrenceId: 'timeline-idle-sleep-time',
        label: t('timeline.idleSleepTime', 'Idle / sleep time'),
        description: t('timeline.summary.idleSleepDescription', 'Combined online, parked, idle, asleep, sleeping and offline time, rounded to whole minutes'),
        rawValue: source.available ? idleSleepTime : null,
      },
    ];
  return <section aria-label={t('timeline.kpis', 'Summary metrics')}><StatStrip
    id="timeline-summary"
    title={t('timeline.kpis', 'Summary metrics')}
    period={period}
    loading={source.enabled && source.loading && !source.paused && !source.available}
    retained={source.available && Boolean(source.error)}
    metrics={metrics.map(metric => ({
      ...metric,
      missingReason: t('timeline.summary.missing', 'No state summary is available for this window'),
    }))}
    footer={!source.available && (!source.loading || source.paused) ? <TimelineSource
      source={{ ...source, error: source.available ? null : source.error, paused: source.available ? false : source.paused }}
      label={t('timeline.kpis', 'Summary metrics')}
    >{null}</TimelineSource> : undefined}
    error={source.available && source.error
      ? `${t('timeline.source.retained', 'Showing retained {{section}} after a refresh failed', { section: t('timeline.kpis', 'Summary metrics') })}: ${getErrorMessage(source.error)}`
      : null}
    secondary={source.available && source.paused
      ? t('timeline.source.pausedRetained', 'Refresh is paused; retained {{section}} remains available', { section: t('timeline.kpis', 'Summary metrics') })
      : undefined}
  /></section>;
}
