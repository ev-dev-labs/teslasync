import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { MetricDisplayOptions } from '@/lib/metric-reference';
import { QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function SlowQuerySummary({ count, totals, limit, metricLabel, known, loading, error, onRetry, retained = false }: {
  count: number;
  totals: { calls: number; totalMs: number; cacheRatio: number | null; maxMean: number; maxPeak: number };
  limit: number; metricLabel: string; known: boolean; loading: boolean;
  error: unknown; onRetry: () => void; retained?: boolean;
}) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const title = t('admin.slowQueries.kpis', 'Query performance summary');
  const scope = t('admin.slowQueries.kpiAnalyzedSub', 'Top {{limit}} by {{metric}}', { limit, metric: metricLabel });
  const latencyDisplay: MetricDisplayOptions = { precision, units: { locale }, latencyStyle: 'adaptive' };
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'queries-analyzed', rawValue: known ? count : null,
      label: t('admin.slowQueries.kpiAnalyzed', 'Queries analyzed'), description: scope, context: scope },
    { metricId: 'count', occurrenceId: 'total-calls', rawValue: known ? totals.calls : null,
      display: { notation: 'compact', precision, units: { locale } },
      label: t('admin.slowQueries.kpiCalls', 'Total calls'),
      description: t('admin.slowQueries.kpiCallsSub', 'Across shown queries'),
      context: t('admin.slowQueries.kpiCallsSub', 'Across shown queries') },
    { metricId: 'latency', occurrenceId: 'aggregate-time', rawValue: known ? totals.totalMs / 1000 : null,
      display: latencyDisplay, label: t('admin.slowQueries.kpiTotalTime', 'Aggregate time'),
      description: t('admin.slowQueries.kpiTotalTimeSub', 'Summed total_time'),
      context: t('admin.slowQueries.kpiTotalTimeSub', 'Summed total_time') },
    { metricId: 'latency', occurrenceId: 'slowest-mean', rawValue: known ? totals.maxMean / 1000 : null,
      display: latencyDisplay, label: t('admin.slowQueries.kpiSlowestMean', 'Slowest mean'),
      description: t('admin.slowQueries.kpiSlowestMeanSub', 'Worst per-call average'),
      context: t('admin.slowQueries.kpiSlowestMeanSub', 'Worst per-call average') },
    { metricId: 'latency', occurrenceId: 'peak-max', rawValue: known ? totals.maxPeak / 1000 : null,
      display: latencyDisplay, label: t('admin.slowQueries.kpiPeak', 'Peak max'),
      description: t('admin.slowQueries.kpiPeakSub', 'Slowest single call'),
      context: t('admin.slowQueries.kpiPeakSub', 'Slowest single call') },
    { metricId: 'percent', occurrenceId: 'cache-hit-ratio', rawValue: known ? totals.cacheRatio : null,
      display: { precision, units: { locale } }, label: t('admin.slowQueries.kpiCache', 'Cache hit ratio'),
      description: t('admin.slowQueries.kpiCacheSub', 'Shared-buffer hits'),
      context: t('admin.slowQueries.kpiCacheSub', 'Shared-buffer hits') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  return (
    <section className="min-w-0" data-retained={retained}>
      <OperationalBrief compact testId="slow-queries-summary" metrics={briefMetrics}
        eyebrow={t('admin.slowQueries.pageTitle', 'Slow queries')} title={title}
        description={t('admin.slowQueries.kpiCallsSub', 'Across shown queries')}
        statusLabel={loading ? t('common.loading', 'Loading') : error ? t('common.error', 'Error')
          : retained ? t('admin.operationalBrief.retained', 'Retained evidence')
          : known ? t('admin.operationalBrief.snapshot', 'Source snapshot')
          : t('admin.operationalBrief.unmeasured', 'Not measured')}
        statusTone={error || retained ? 'warning' : 'neutral'}
        scope={<span>{scope} · {t('admin.operationalBrief.periodUnknown', 'Observation time and complete analysis bounds are not supplied by this source.')}</span>}
        loading={loading && !retained}
        freshness={retained ? t('admin.operationalBrief.retained', 'Retained evidence') : undefined}
        provenance={t('admin.slowQueries.kpiCallsSub', 'Across shown queries')} />
      {error && <QueryError error={error} onRetry={onRetry}
        resourceName={t('admin.slowQueries.pageTitle', 'Slow queries')} />}
    </section>
  );
}
