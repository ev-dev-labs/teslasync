import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { DataProvenance, DataStatus } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';
import type {
  ActionCenterProviderStatus,
  ActionCenterSummary as Summary,
} from '@/types/actionCenter';

interface ActionCenterSummaryProps {
  summary: Summary | null;
  loading: boolean;
  status: DataStatus;
  provenance: DataProvenance;
  generatedAt: string | null;
  vehicleName: string | null;
  providers: readonly ActionCenterProviderStatus[];
}

export function ActionCenterSummary({
  summary, loading, status, provenance, generatedAt, vehicleName, providers,
}: ActionCenterSummaryProps) {
  const { t } = useTranslation();
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'open',
      label: t('actionCenter.summary.open', 'Open'), rawValue: summary?.open,
      description: t('actionCenter.summary.openHelp', 'Generated recommendations in the open state.'),
    },
    {
      metricId: 'count', occurrenceId: 'critical',
      label: t('actionCenter.summary.critical', 'Critical'),
      rawValue: summary?.critical,
      description: t('actionCenter.summary.criticalHelp', 'Generated recommendations with critical priority across all inbox states.'),
    },
    {
      metricId: 'count', occurrenceId: 'high',
      label: t('actionCenter.summary.high', 'High'), rawValue: summary?.high,
      description: t('actionCenter.summary.highHelp', 'Generated recommendations with high priority across all inbox states.'),
    },
    {
      metricId: 'count', occurrenceId: 'acknowledged',
      label: t('actionCenter.summary.acknowledged', 'Acknowledged'),
      rawValue: summary?.acknowledged,
      description: t('actionCenter.summary.acknowledgedHelp', 'Generated recommendations in the acknowledged state.'),
    },
    {
      metricId: 'count', occurrenceId: 'snoozed',
      label: t('actionCenter.summary.snoozed', 'Snoozed'),
      rawValue: summary?.snoozed,
      description: t('actionCenter.summary.snoozedHelp', 'Generated recommendations in the snoozed state.'),
    },
    {
      metricId: 'count', occurrenceId: 'dismissed',
      label: t('actionCenter.summary.dismissed', 'Dismissed'),
      rawValue: summary?.dismissed,
      description: t('actionCenter.summary.dismissedHelp', 'Generated recommendations in the dismissed state.'),
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const labels: Record<DataStatus, string> = {
    initial: t('actionCenter.summary.status.initial', 'Awaiting summary evidence'),
    initialFailure: t('actionCenter.summary.status.initialFailure', 'Summary request failed'),
    ok: t('actionCenter.summary.status.ok', 'Summary returned'),
    stale: t('actionCenter.summary.status.stale', 'Retained summary'),
    partial: t('actionCenter.summary.status.partial', 'Partial source coverage'),
    unavailable: t('actionCenter.summary.status.unavailable', 'Summary unavailable'),
  };
  const coverageIncomplete = summary != null
    && (providers.length === 0 || providers.some((provider) => provider.status !== 'available'));
  const effectiveStatus = status === 'ok'
    ? summary == null ? 'unavailable' : coverageIncomplete ? 'partial' : status
    : status;
  const scope = t(
    'actionCenter.summary.scope',
    '{{vehicle}} · Before priority, source, state, and pagination filters',
    { vehicle: vehicleName ?? t('actionCenter.filters.allVehicles', 'All vehicles') },
  );
  const windowContext = t(
    'actionCenter.summary.windowContext',
    'Provider-specific evidence windows and limits apply; these counts are not an all-time total.',
  );

  return (
    <section aria-label={t('actionCenter.summary.label', 'Action center summary')}>
      <OperationalBrief
        compact
        loading={loading}
        eyebrow={t('actionCenter.summary.eyebrow', 'Decision inbox')}
        title={t('actionCenter.summary.title', 'Decision queue overview')}
        description={t('actionCenter.summary.description', 'Recommendation state and priority counts from generated evidence, not just the visible page.')}
        statusLabel={labels[effectiveStatus]}
        statusTone={effectiveStatus === 'initialFailure' ? 'danger'
          : effectiveStatus === 'stale' || effectiveStatus === 'partial' ? 'warning' : 'neutral'}
        metrics={operationalMetrics}
        scope={scope}
        freshness={generatedAt
          ? t('actionCenter.summary.generatedAt', 'Generated {{date}}', { date: formatDateTime(generatedAt) })
          : t('actionCenter.summary.generatedUnknown', 'Generation time unavailable')}
        provenance={provenance}
        narrative={{
          whatChanged: scope,
          whyItMatters: windowContext,
          confidence: { label: 'not_scored', score: null, basis: [] },
          likelyCause: null,
          recommendedResponse: null,
          limitations: [
            windowContext,
            ...(coverageIncomplete
              ? [t('actionCenter.summary.coverageIncomplete', 'Source coverage is incomplete or unknown; unavailable sources do not imply zero findings.')]
              : []),
          ],
          evidence: [],
          provenance: [{ source: t('actionCenter.summary.evidenceSource', 'Server-generated recommendation evidence'), method: provenance }],
        }}
      />
    </section>
  );
}
