import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { QueryError } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CorrelationResult } from '../../lib/signalCorrelation';

interface Props {
  result: CorrelationResult | null;
  leadLabel: string;
  loading: boolean;
  retained: boolean;
  errorA: Error | null;
  errorB: Error | null;
  onRetryA: () => void;
  onRetryB: () => void;
}

export function CorrelationStatStrip({ result, leadLabel, loading, retained, errorA, errorB, onRetryA, onRetryB }: Props) {
  const { t } = useTranslation();
  const { fmtScientificNumber, fmtInt, precision } = useNumberFormatting();
  const metrics: StatMetric[] = [
    { metricId: 'ratio', occurrenceId: 'peak-r', rawValue: result?.bestR,
      display: { precision: Math.max(3, precision) },
      label: t('signalCorrelation.bestR', 'Peak correlation'),
      description: t('help.signalCorrelation.bestR', 'An ordinary overlay chart only ever shows the zero-lag correlation, which misses every relationship with a delay in it. Sweeping the lag finds the shift at which the two signals line up best, and the difference between the peak and the zero-lag value is exactly the information a static chart throws away.'),
      context: t('signalCorrelation.zeroLag', 'at zero lag: {{r}}', {
        r: result == null ? '—' : fmtScientificNumber(result.zeroLagR, 3),
      }) },
    { metricId: 'duration', occurrenceId: 'best-lag', rawValue: result?.bestLagS,
      display: { units: { duration: 's' }, precision: 0 },
      label: t('signalCorrelation.bestLag', 'Best lag'), context: leadLabel,
      description: t('statstrip.correlation.lagDescription', 'Signed time shift in seconds; positive means signal B lags signal A, negative means signal A lags signal B.') },
    { metricId: 'status', occurrenceId: 'significance', rawValue: result == null ? null
        : result.significant ? t('signalCorrelation.real', 'Real') : t('signalCorrelation.noise', 'Noise'),
      label: t('signalCorrelation.significance', 'Significance'),
      description: t('statstrip.correlation.significanceDescription', 'The existing autocorrelation-adjusted significance test; the threshold is a coefficient, not a percentage.'),
      context: t('signalCorrelation.threshold', 'needs |r| > {{v}}', {
        v: result == null ? '—' : fmtScientificNumber(result.significanceThreshold, 3),
      }) },
    { metricId: 'number', occurrenceId: 'effective-n', rawValue: result?.effectiveN,
      display: { precision: 0 }, label: t('signalCorrelation.effectiveN', 'Effective samples'),
      description: t('statstrip.correlation.samplesDescription', 'Autocorrelation-adjusted effective sample size at the best lag; raw points are overlapping samples at that lag.'),
      context: t('signalCorrelation.rawN', 'from {{n}} raw points', {
        n: result == null ? '—' : fmtInt(result.bestN),
      }) },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <section aria-label={t('signalCorrelation.kpis', 'Correlation metrics')}>
    <OperationalBrief compact testId="signal-correlation-summary" metrics={operationalMetrics} loading={loading && !retained}
      eyebrow={t('signalCorrelation.title', 'Signal correlation')}
      title={t('signalCorrelation.kpis', 'Correlation metrics')}
      description={t('statstrip.correlation.periodReason', 'The two histories are queried independently. Only valid overlapping samples contribute; exact request bounds are not supplied by these queries.')}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : errorA || errorB ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : result == null ? t('operationalSummary.unknown', 'Source values unknown') : t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || errorA || errorB ? 'warning' : 'neutral'}
      scope={t('statstrip.correlation.period', 'Last 24 hours requested; overlapping samples only')}
      freshness={retained ? t('developerReference.stats.state.retained', 'Showing retained measurements') : undefined} />
      <div className="space-y-2">
        {errorA && <div><Text variant="caption">{t('signalCorrelation.signalA', 'Signal A')}</Text>
          <QueryError error={errorA} onRetry={onRetryA} /></div>}
        {errorB && <div><Text variant="caption">{t('signalCorrelation.signalB', 'Signal B')}</Text>
          <QueryError error={errorB} onRetry={onRetryB} /></div>}
      </div>
  </section>;
}
