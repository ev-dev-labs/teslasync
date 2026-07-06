/**
 * Ingest X-Ray — KPI band.
 *
 * Full-width responsive MetricCard grid summarising the current X-Ray
 * window: total samples, distinct fields, peak + average samples per
 * bucket (derived from the bucket series), and the window / bucket the
 * operator selected (echoed back so the band reads self-explanatory).
 *
 * Values fall back to an em-dash until a vehicle is selected and data has
 * arrived — the two selection KPIs (window / bucket) always reflect the
 * operator's current picker choice regardless of data.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Clock, Gauge, Layers, Timer, TrendingUp } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type {
  IngestXRayBucket,
  IngestXRayResponse,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

interface XRayHeaderProps {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
}

const WINDOW_LABEL: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

const BUCKET_LABEL: Record<IngestXRayBucket, string> = {
  '30s': '30 seconds',
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
};

const DASH = '—';

export function XRayHeader({
  data,
  loading,
  windowSel,
  bucketSel,
}: XRayHeaderProps) {
  const { t } = useTranslation();

  // Peak + mean samples per bucket, derived from the same series the hero
  // chart renders. Empty series → zeros; the band still shows the dash until
  // `data` exists so "no vehicle / loading" never reads as a real 0.
  const { peak, avg } = useMemo(() => {
    const counts = (data?.buckets ?? []).map((b) => b.count ?? 0);
    if (counts.length === 0) return { peak: 0, avg: 0 };
    return {
      peak: Math.max(...counts),
      avg: counts.reduce((sum, c) => sum + c, 0) / counts.length,
    };
  }, [data]);

  const ready = !loading && !!data;

  return (
    <section
      aria-label={t('admin.xray.kpis', 'Ingest summary metrics')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6"
    >
      <MetricCard
        label={t('admin.xray.stats.samples', 'Total samples')}
        value={ready ? fmtInt(data.total_samples ?? 0) : DASH}
        icon={<Activity className="h-5 w-5" />}
        color="cyan"
        subtitle={t('admin.xray.stats.samplesSub', 'within selected window')}
      />
      <MetricCard
        label={t('admin.xray.stats.fields', 'Distinct fields')}
        value={ready ? fmtInt(data.unique_fields ?? 0) : DASH}
        icon={<Layers className="h-5 w-5" />}
        color="blue"
        subtitle={t('admin.xray.stats.fieldsSub', 'unique signal names')}
      />
      <MetricCard
        label={t('admin.xray.stats.peak', 'Peak / bucket')}
        value={ready ? fmtInt(peak) : DASH}
        icon={<TrendingUp className="h-5 w-5" />}
        color="amber"
        subtitle={t('admin.xray.stats.peakSub', 'busiest interval')}
      />
      <MetricCard
        label={t('admin.xray.stats.avg', 'Avg / bucket')}
        value={ready ? fmtNumber(avg, 1) : DASH}
        icon={<Gauge className="h-5 w-5" />}
        color="purple"
        subtitle={t('admin.xray.stats.avgSub', 'mean per interval')}
      />
      <MetricCard
        label={t('admin.xray.stats.window', 'Window')}
        value={t(`admin.xray.windowLabel.${windowSel}`, WINDOW_LABEL[windowSel] ?? windowSel)}
        icon={<Clock className="h-5 w-5" />}
        color="green"
        subtitle={t('admin.xray.stats.windowSub', 'observation horizon')}
      />
      <MetricCard
        label={t('admin.xray.stats.bucket', 'Bucket')}
        value={t(`admin.xray.bucketLabel.${bucketSel}`, BUCKET_LABEL[bucketSel] ?? bucketSel)}
        icon={<Timer className="h-5 w-5" />}
        color="cyan"
        subtitle={t('admin.xray.stats.bucketSub', 'aggregation interval')}
      />
    </section>
  );
}
