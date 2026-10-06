import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { OperationalBrief, DataProvenanceBadge } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface DashboardSourceBriefProps {
  metrics: readonly StatMetric[];
  state: DataState<unknown>;
  eyebrow: string;
  title: string;
  description: string;
  scope: ReactNode;
  freshness?: ReactNode;
  loading?: boolean;
  testId: string;
}

export function DashboardSourceBrief({
  metrics, state, eyebrow, title, description, scope, freshness, loading, testId,
}: DashboardSourceBriefProps) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  const statuses = {
    initial: t('dashboard.summary.status.initial', 'Awaiting source'),
    initialFailure: t('dashboard.summary.status.initialFailure', 'Source unavailable'),
    ok: t('dashboard.summary.status.ok', 'Source available'),
    stale: t('dashboard.summary.status.stale', 'Retained readings'),
    partial: t('dashboard.summary.status.partial', 'Partial evidence'),
    unavailable: t('dashboard.summary.status.unavailable', 'No source readings'),
  };

  return (
    <OperationalBrief
      compact
      testId={testId}
      eyebrow={eyebrow}
      title={title}
      description={description}
      metrics={operationalMetrics}
      statusLabel={statuses[state.status]}
      statusTone={state.fatalError ? 'danger' : state.status === 'stale' || state.status === 'partial' ? 'warning' : 'neutral'}
      scope={<Caption>{scope}</Caption>}
      freshness={<>
        <DataProvenanceBadge provenance={state.provenance} status={state.status} updatedAt={state.updatedAt} />
        {freshness}
      </>}
      loading={loading}
      provenance={typeof scope === 'string' ? `${description} ${scope}` : description}
    />
  );
}
