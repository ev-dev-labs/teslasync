import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { OperationalBrief } from '@/components/data-display';
import { Button } from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';

interface MapsOperationalBriefProps {
  title: string;
  description: string;
  scope: ReactNode;
  metrics: readonly StatMetric[];
  sources: readonly { label: string; state: DataState<unknown> }[];
  loading?: boolean;
  onRetry?: () => void;
}

export function MapsOperationalBrief({ title, description, scope, metrics, sources, loading = false, onRetry }: MapsOperationalBriefProps) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  const states = sources.map(({ state }) => state);
  const status = states.some((state) => state.refreshError || state.isRefreshBlocked || state.status === 'stale')
    ? 'retained'
    : states.some((state) => !state.hasData)
      ? states.every((state) => !state.hasData) ? 'unavailable' : 'partial'
      : 'available';
  const labels = {
    retained: t('mapsBrief.status.retained', 'Retained source data'),
    unavailable: t('mapsBrief.status.unavailable', 'Source data unavailable'),
    partial: t('mapsBrief.status.partial', 'Independent sources incomplete'),
    available: t('mapsBrief.status.available', 'Source data available'),
  };

  return (
    <OperationalBrief
      compact
      eyebrow={t('mapsBrief.eyebrow', 'Location evidence')}
      title={title}
      description={description}
      statusLabel={loading ? t('mapsBrief.status.loading', 'Loading source data') : labels[status]}
      statusTone={status === 'retained' || status === 'partial' ? 'warning' : 'neutral'}
      metrics={operationalMetrics}
      scope={scope}
      loading={loading}
      freshness={sources.map(({ label, state }) => (
        <span key={label}>
          {label}: {state.updatedAt != null
            ? formatDateTime(new Date(state.updatedAt).toISOString())
            : t('mapsBrief.freshness.unknown', 'Receipt time unknown')}
        </span>
      ))}
      provenance={sources.map(({ label, state }) => `${label}: ${state.provenance}`).join('; ')}
      actions={onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry', 'Retry')}
        </Button>
      )}
    />
  );
}
