import type { StatMetric } from '@/components/data-display';
import type { StatPeriod } from '@/lib/metric-reference';
import type { IngestXRayBucket, IngestXRayResponse, IngestXRayWindow } from '@/types/admin-diagnostics';

type Translate = (key: string, fallback: string) => string;
const windows: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours',
};
const buckets: Record<IngestXRayBucket, string> = {
  '30s': '30 seconds', '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour',
};

export function ingestMetrics(
  data: IngestXRayResponse | undefined, window: IngestXRayWindow, bucket: IngestXRayBucket, t: Translate,
): { metrics: StatMetric[]; period: StatPeriod } {
  const counts = data?.buckets?.map(point => point.count);
  const valid = counts?.every(count => Number.isSafeInteger(count) && count >= 0);
  const peak = valid && counts ? (counts.length ? Math.max(...counts) : 0) : undefined;
  const mean = valid && counts ? (counts.length ? counts.reduce((sum, count) => sum + count, 0) / counts.length : 0) : undefined;
  const windowLabel = t(`admin.xray.windowLabel.${window}`, windows[window]);
  const bucketLabel = t(`admin.xray.bucketLabel.${bucket}`, buckets[bucket]);
  return {
    // The response supplies generation time, not exact query bounds.
    period: { kind: 'unknown', label: windowLabel },
    metrics: [
      { metricId: 'count', occurrenceId: 'samples', rawValue: data?.total_samples,
        label: t('admin.xray.stats.samples', 'Total samples'),
        context: t('admin.xray.stats.samplesSub', 'within selected window') },
      { metricId: 'count', occurrenceId: 'fields', rawValue: data?.unique_fields,
        label: t('admin.xray.stats.fields', 'Distinct fields'),
        context: t('admin.xray.stats.fieldsSub', 'unique signal names') },
      { metricId: 'count', occurrenceId: 'peak', rawValue: peak,
        label: t('admin.xray.stats.peak', 'Peak / bucket'),
        context: t('admin.xray.stats.peakSub', 'busiest interval') },
      { metricId: 'number', occurrenceId: 'mean', rawValue: mean,
        label: t('admin.xray.stats.avg', 'Avg / bucket'),
        context: t('admin.xray.stats.avgSub', 'mean per interval') },
      { metricId: 'text', occurrenceId: 'window', rawValue: windowLabel,
        label: t('admin.xray.stats.window', 'Window'),
        context: t('admin.xray.stats.windowSub', 'observation horizon') },
      { metricId: 'text', occurrenceId: 'bucket', rawValue: bucketLabel,
        label: t('admin.xray.stats.bucket', 'Bucket'),
        context: t('admin.xray.stats.bucketSub', 'aggregation interval') },
    ],
  };
}
