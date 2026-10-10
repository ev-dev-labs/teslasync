import type { TFunction } from 'i18next';
import type { AnomalyData } from '@/api/hooks/useAnomalies';
import type { StatMetric, StatPeriod } from '@/components/data-display';

/** The response combines current detector coverage with two independent rolling counts. */
export function anomalySummary(data: AnomalyData | undefined, t: TFunction): {
  metrics: StatMetric[];
  period: StatPeriod;
} {
  const snapshot = t('anomaly.summary.snapshot', 'Current detector snapshot');
  return {
    period: {
      kind: 'unknown',
      label: t('anomaly.summary.period', 'Current snapshot · last 7 days · last 24 hours'),
      reason: t('anomaly.summary.scope', 'Coverage and health categories describe the current detector snapshot. Anomaly counts retain their separate 7-day and 24-hour source windows.'),
    },
    metrics: [
      {
        metricId: 'count', occurrenceId: 'anomaly-monitored', rawValue: data?.signals_monitored,
        label: t('anomaly.monitored', 'Signals monitored'), context: snapshot,
        display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'anomaly-7d', rawValue: data?.anomalies_last_7d,
        label: t('anomaly.last7d', 'Anomalies (7d)'),
        context: t('anomaly.summary.sevenDays', 'Last 7 days'),
        display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'anomaly-24h', rawValue: data?.anomalies_last_24h,
        label: t('anomaly.last24h', 'Anomalies (24h)'),
        context: t('anomaly.summary.day', 'Last 24 hours'),
        display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'anomaly-health-categories',
        rawValue: data?.health_summary != null ? Object.keys(data.health_summary).length : null,
        label: t('anomaly.categories', 'Health categories'), context: snapshot,
        display: { notation: 'source' },
      },
    ],
  };
}
