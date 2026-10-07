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
}

export function VehicleEvidenceBrief({
  id, title, description, metrics: sourceMetrics, status, scope, provenance, freshness, loading,
}: VehicleEvidenceBriefProps) {
  const { t } = useTranslation();
  const bridgedMetrics = useOperationalMetrics(sourceMetrics);
  const metrics = bridgedMetrics.map((metric, index) => index === 0 ? {
    ...metric,
    detail: <>{metric.detail}<div>{scope}</div></>,
  } : metric);
  const labels: Record<DataStatus, string> = {
    initial: t('vehicles.evidenceBrief.status.initial', 'Loading source'),
    ok: t('vehicles.evidenceBrief.status.ok', 'Source returned'),
    stale: t('vehicles.evidenceBrief.status.stale', 'Retained after refresh failure'),
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
