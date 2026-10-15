import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataStatus } from '@/api/dataState';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface VehicleEvidenceBriefProps {
  id: string;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  status: DataStatus;
  scope: ReactNode;
  provenance: string;
  freshness?: ReactNode;
  loading?: boolean;
  /** True only when retained data follows an actual refresh error (not a pause). */
  refreshFailed?: boolean;
}

export function VehicleEvidenceBrief({
  id, title, description, metrics: sourceMetrics, status, scope, provenance, freshness, loading, refreshFailed = false,
}: VehicleEvidenceBriefProps) {
  const { t } = useTranslation();
  const bridgedMetrics = useOperationalMetrics(sourceMetrics);
  const metrics = bridgedMetrics.map((metric, index) => index === 0 ? {
    ...metric,
    detail: <>{metric.detail}<div>{scope}</div></>,
  } : metric);
  const labels: Record<DataStatus, string> = {
    initial: loading === false
      ? t('dataSources.status.pending', 'Pending')
      : t('vehicles.evidenceBrief.status.initial', 'Loading source'),
    ok: t('vehicles.evidenceBrief.status.ok', 'Source returned'),
    // Cause-neutral unless the retained data follows an actual refresh error.
    stale: refreshFailed
      ? t('vehicles.evidenceBrief.status.stale', 'Retained after refresh failure')
      : t('vehicles.evidenceBrief.status.retained', 'Retained source snapshots'),
    partial: t('vehicles.evidenceBrief.status.partial', 'Partial source coverage'),
    unavailable: t('vehicles.evidenceBrief.status.unavailable', 'No source data'),
    initialFailure: t('vehicles.evidenceBrief.status.initialFailure', 'Source unavailable'),
  };
  return <OperationalBrief compact testId={id}
    eyebrow={t('vehicles.evidenceBrief.eyebrow', 'Vehicle evidence')}
    title={title} description={description}
    statusLabel={labels[status]}
    statusTone={status === 'stale' || status === 'partial' || status === 'initialFailure' ? 'warning' : 'neutral'}
    loading={loading ?? status === 'initial'}
    metrics={metrics} scope={scope} freshness={freshness} provenance={provenance} />;
}
