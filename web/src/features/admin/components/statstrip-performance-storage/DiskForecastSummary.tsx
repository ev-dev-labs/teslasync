import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { HypertableSize } from '@/types/admin-operator-confidence';

interface DiskForecastSummaryProps {
  totals: { total: number; uncompressed: number; compressed: number; growth: number };
  count: number;
  largest: HypertableSize | null;
  soonest: HypertableSize | null;
  known: boolean;
  loading: boolean;
  retained: boolean;
  error: unknown;
  onRetry: () => void;
  pctOf: (part: number, whole: number) => string;
}

export function DiskForecastSummary({
  totals, count, largest, soonest, known, loading, retained, error, onRetry, pctOf,
}: DiskForecastSummaryProps) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const title = t('admin.diskForecast.kpis', 'Fleet disk summary');
  const growthHint = t('admin.diskForecast.growthSub', 'Sum across all hypertables');
  const bytesDisplay = { precision, units: { locale } };
  const share = (part: number) => known
    ? t('admin.diskForecast.percentSub', '{{pct}} of total', { pct: pctOf(part, totals.total) }) : '—';
  const metrics: StatMetric[] = [
    { metricId: 'bytes', occurrenceId: 'total-disk', rawValue: known ? totals.total : null,
      display: bytesDisplay, label: t('admin.diskForecast.fleetTotal', 'Total disk'), description: growthHint,
      context: known ? t('admin.diskForecast.tableCount', '{{count}} hypertables', { count }) : '—' },
    { metricId: 'bytes', occurrenceId: 'uncompressed', rawValue: known ? totals.uncompressed : null,
      display: bytesDisplay, label: t('admin.diskForecast.fleetUncompressed', 'Uncompressed'),
      description: growthHint, context: share(totals.uncompressed) },
    { metricId: 'bytes', occurrenceId: 'compressed', rawValue: known ? totals.compressed : null,
      display: bytesDisplay, label: t('admin.diskForecast.fleetCompressed', 'Compressed'),
      description: growthHint, context: share(totals.compressed) },
    { metricId: 'byteRate', occurrenceId: 'daily-growth', rawValue: known ? totals.growth / 86400 : null,
      display: { ...bytesDisplay, byteRatePeriod: 'd' }, label: t('admin.diskForecast.fleetGrowth', 'Growth (per day)'),
      description: growthHint, context: growthHint },
    { metricId: 'bytes', occurrenceId: 'largest-table', rawValue: largest ? largest.total_bytes ?? 0 : null,
      display: bytesDisplay, label: t('admin.diskForecast.largest', 'Largest table'),
      context: largest?.hypertable_name ?? t('admin.diskForecast.noData', 'No data') },
    { metricId: 'duration', occurrenceId: 'soonest-quota',
      rawValue: soonest ? (soonest.est_days_to_quota ?? 0) * 86400 : null,
      display: { precision, units: { locale, duration: 'd' } },
      label: t('admin.diskForecast.soonestQuota', 'Soonest quota'),
      description: t('admin.diskForecast.colDays', 'Days to quota'),
      context: !known ? '—' : soonest?.hypertable_name ?? t('admin.diskForecast.noQuota', 'No quota configured') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  return (
    <section className="min-w-0" data-retained={retained}>
      <OperationalBrief compact testId="disk-forecast-summary" metrics={briefMetrics}
        eyebrow={t('admin.diskForecast.pageTitle', 'Disk forecast')} title={title} description={growthHint}
        statusLabel={loading ? t('common.loading', 'Loading') : error ? t('common.error', 'Error')
          : retained ? t('admin.operationalBrief.retained', 'Retained evidence')
          : known ? t('admin.operationalBrief.snapshot', 'Source snapshot')
          : t('admin.operationalBrief.unmeasured', 'Not measured')}
        statusTone={error || retained ? 'warning' : 'neutral'}
        scope={<span>{growthHint} · {t('admin.operationalBrief.periodUnknown', 'Observation time and complete analysis bounds are not supplied by this source.')}</span>}
        loading={loading && !retained}
        freshness={retained ? t('admin.operationalBrief.retained', 'Retained evidence') : undefined}
        provenance={growthHint} />
      {Boolean(error) && <QueryError error={error} onRetry={onRetry}
        resourceName={t('admin.diskForecast.pageTitle', 'Disk forecast')} />}
    </section>
  );
}
