import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { IngestXRayBucket, IngestXRayResponse, IngestXRayWindow } from '@/types/admin-diagnostics';
import { ingestMetrics } from './ingestMetrics';
import { briefSourceStatus } from './briefSourceStatus';

interface Props {
  data: IngestXRayResponse | undefined;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
  loading: boolean;
  retained: boolean;
  enabled: boolean;
  error?: Error | null;
}

export function IngestOperationalBrief({ data, windowSel, bucketSel, loading, retained, enabled, error }: Props) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { precision, locale } = useNumberFormatting();
  const model = ingestMetrics(data, windowSel, bucketSel, t);
  const metrics = model.metrics.map(metric => ({
    ...metric, display: { precision, units: { locale } },
  }));
  const briefMetrics = useOperationalMetrics(metrics);
  const status = briefSourceStatus(t, { enabled, hasData: data != null, loading, retained, failed: !!error });
  const description = t('admin.xray.subtitle', 'Per-vehicle telemetry sample counts — pick a vehicle to inspect what the ingest pipeline is receiving.');
  const boundsUnknown = t('admin.xray.brief.boundsUnknown', 'Exact query bounds are not supplied');
  return <div data-testid="ingest-xray-summary" data-retained={retained}>
    {retained && <Text as="p" variant="caption" role="status">
      {t('developerReference.stats.state.retained', 'Showing retained measurements')}
    </Text>}
    <OperationalBrief compact metrics={briefMetrics} {...status} testId="ingest-xray-operational-brief"
      eyebrow={t('admin.xray.pageTitle', 'Ingest x-ray')}
      title={t('admin.xray.kpis', 'Ingest summary metrics')}
      description={description}
      scope={<Text as="span" variant="caption">
        {model.period.label} · {boundsUnknown}
      </Text>}
      freshness={data?.generated_at ? <Text as="span" variant="caption">
        {t('admin.xray.brief.generatedAt', 'Generated at')}: {formatDateTime(data.generated_at)}
      </Text> : undefined}
      provenance={t('admin.xray.stats.samplesSub', 'within selected window')}
      narrative={{
        whatChanged: description, whyItMatters: null,
        confidence: { label: 'not_scored', score: null, basis: [] },
        likelyCause: null, recommendedResponse: null, limitations: [boundsUnknown],
        evidence: data?.generated_at ? [{
          id: 'ingest-generated', summary: t('admin.xray.brief.generatedAt', 'Generated at'),
          observedAt: data.generated_at, provenance: { source: t('admin.xray.pageTitle', 'Ingest x-ray') },
        }] : [],
        provenance: [{ source: t('admin.xray.pageTitle', 'Ingest x-ray'), method: model.period.label }],
      }}
      loading={loading && !retained}
    />
  </div>;
}
