import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataProvenance, DataState } from '@/api/dataState';
import { OperationalBrief } from '@/components/data-display';
import { Button, Text } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface MapsOperationalBriefProps {
  title: string;
  description: string;
  scope: ReactNode;
  metrics: readonly StatMetric[];
  sources: readonly { label: string; state: DataState<unknown> }[];
  loading?: boolean;
  onRetry?: () => void;
  variant?: 'standalone' | 'embedded';
}

export function MapsOperationalBrief({ title, description, scope, metrics, sources, loading, onRetry, variant = 'standalone' }: MapsOperationalBriefProps) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const operationalMetrics = useOperationalMetrics(metrics);
  const states = sources.map(({ state }) => state);
  const usable = states.filter((state) => state.hasData && state.status !== 'unavailable');
  const initialLoading = states.length > 0 && states.every((state) =>
    !state.hasData && state.status === 'initial' && !state.isRefreshBlocked);
  const status = usable.length === 0
    ? 'unavailable'
    : usable.length < states.length || states.some((state) => state.status === 'partial')
      ? 'partial'
      : states.some((state) => state.refreshError || state.isRefreshBlocked || state.status === 'stale')
        ? 'retained'
        : 'available';
  // Explicit query activity distinguishes a disabled source from its initial status.
  const isLoading = loading ?? initialLoading;
  const labels = {
    retained: t('mapsBrief.status.retained', 'Retained source data'),
    unavailable: t('mapsBrief.status.unavailable', 'Source data unavailable'),
    partial: t('mapsBrief.status.partial', 'Independent sources incomplete'),
    available: t('mapsBrief.status.available', 'Source data available'),
  };
  const provenanceLabels: Record<DataProvenance, string> = {
    live: t('provenance.live', 'Live'),
    cached: t('provenance.cached', 'Cached'),
    historical: t('provenance.historical', 'Historical'),
    inferred: t('provenance.inferred', 'Estimated'),
    repaired: t('provenance.repaired', 'Repaired'),
    unknown: t('provenance.unknown', 'Unknown source'),
  };

  return (
    <OperationalBrief
      compact
      variant={variant}
      eyebrow={t('mapsBrief.eyebrow', 'Location evidence')}
      title={title}
      description={description}
      statusLabel={isLoading ? t('mapsBrief.status.loading', 'Loading source data') : labels[status]}
      statusTone={status === 'retained' || status === 'partial' ? 'warning' : 'neutral'}
      metrics={operationalMetrics}
      scope={scope}
      loading={isLoading}
      freshness={sources.map(({ label, state }) => {
        const receivedAt = state.updatedAt != null ? new Date(state.updatedAt) : null;
        return (
          <Text as="span" key={label} size="xs" color="muted" className="min-w-0 break-words"
            data-source-label={label} data-provenance={state.provenance}>
            {label}: {receivedAt != null && Number.isFinite(receivedAt.getTime())
              ? t('mapsBrief.freshness.received', 'Received {{time}} (not observation or last visit)', {
                time: formatDateTime(receivedAt),
              })
              : t('mapsBrief.freshness.unknown', 'Receipt time unknown')}
          </Text>
        );
      })}
      provenance={sources.map(({ label, state }) => `${label}: ${provenanceLabels[state.provenance] ?? provenanceLabels.unknown}`).join('; ')}
      actions={onRetry && (
        <Button size="sm" variant="outline" wrapLabel className="min-h-11 md:min-h-9" onClick={onRetry}>
          {t('common.retry', 'Retry')}
        </Button>
      )}
    />
  );
}
