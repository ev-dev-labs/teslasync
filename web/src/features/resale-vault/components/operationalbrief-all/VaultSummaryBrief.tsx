import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { VaultEvidenceSource } from '../../hooks/useVaultEvidence';

interface VaultSummaryBriefProps {
  id: string;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  hasEvidence: boolean;
  scope: ReactNode;
  sources?: readonly VaultEvidenceSource[];
  provenance?: string;
}

export function VaultSummaryBrief({
  id, title, description, metrics, hasEvidence, scope, sources = [], provenance,
}: VaultSummaryBriefProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const sourceLoads = sources.map((source) => t('resaleVault.brief.sourceLoad', '{{source}} loaded: {{at}}', {
    source: t(source.labelKey, source.label),
    at: source.state.updatedAt != null ? formatDateTime(new Date(source.state.updatedAt)) : '—',
  }));
  const operationalMetrics = useOperationalMetrics(metrics.map((metric) => ({
    ...metric,
    context: <>{metric.context}<div>{scope}</div>{sourceLoads.map((line, index) => <div key={sources[index]?.id}>{line}</div>)}</>,
  })));
  const loading = !hasEvidence && sources.some((source) => source.loading);
  const retained = sources.some((source) =>
    source.state.hasData && (source.state.refreshError != null || source.state.isRefreshBlocked || source.state.status === 'stale'));
  const incomplete = sources.some((source) => source.state.fatalError != null);
  const refreshing = sources.some((source) => source.state.isRefreshing);
  const status = loading ? 'loading' : retained ? 'retained' : incomplete ? 'partial' : refreshing ? 'refreshing' : hasEvidence ? 'available' : 'missing';
  const statuses = {
    loading: t('resaleVault.brief.status.loading', 'Loading evidence'),
    retained: t('resaleVault.brief.status.retained', 'Retained evidence'),
    partial: t('resaleVault.brief.status.partial', 'Some sources unavailable'),
    available: t('resaleVault.brief.status.available', 'Evidence available'),
    missing: t('resaleVault.brief.status.missing', 'No evidence supplied'),
    refreshing: t('resaleVault.brief.status.refreshing', 'Refreshing retained evidence'),
  };

  return (
    <OperationalBrief
      compact
      testId={`vault-${id}-brief`}
      eyebrow={t('resaleVault.brief.eyebrow', 'Vehicle-history evidence')}
      title={title}
      description={description}
      statusLabel={statuses[status]}
      statusTone={retained || incomplete ? 'warning' : 'neutral'}
      metrics={operationalMetrics}
      loading={loading}
      scope={scope}
      freshness={sources.some((source) => source.state.updatedAt != null)
        ? t('resaleVault.brief.loadTimes', 'Load times are shown per source in details')
        : t('resaleVault.brief.loadTimeUnknown', 'Source load time unavailable')}
      provenance={provenance ?? sources.map((source) => t(source.labelKey, source.label)).join('; ')}
    />
  );
}
