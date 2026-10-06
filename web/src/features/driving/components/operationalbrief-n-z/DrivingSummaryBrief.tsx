import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface DrivingSummaryBriefProps {
  id: string;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  scope: ReactNode;
  provenance: string;
  loading?: boolean;
  unavailable?: boolean;
  retained?: boolean;
  freshness?: ReactNode;
  actions?: ReactNode;
  sourceStatus?: string;
}

export function DrivingSummaryBrief({
  id, title, description, metrics, scope, provenance,
  loading = false, unavailable = false, retained = false, freshness, actions, sourceStatus,
}: DrivingSummaryBriefProps) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  const statusLabel = sourceStatus ?? (loading
    ? t('driving.brief.loading', 'Loading source')
    : retained
      ? t('driving.brief.retained', 'Retained source')
      : unavailable
        ? t('driving.brief.unavailable', 'Source unavailable')
        : t('driving.brief.available', 'Source available'));

  return (
    <OperationalBrief
      compact
      testId={id}
      eyebrow={t('driving.brief.eyebrow', 'Driving evidence')}
      title={title}
      description={description}
      statusLabel={statusLabel}
      statusTone={retained || unavailable ? 'warning' : 'neutral'}
      loading={loading}
      metrics={operationalMetrics}
      scope={scope}
      freshness={freshness ?? t('driving.brief.observationUnknown', 'Source observation time not provided')}
      provenance={provenance}
      actions={actions}
    />
  );
}
