import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface Props {
  metrics: readonly StatMetric[];
  eyebrow: string;
  title: string;
  description: string;
  scope: string;
  sourceStatus: string;
  loading?: boolean;
  freshness?: ReactNode;
  testId: string;
}

export function AdminSummary({ metrics, eyebrow, title, description, scope, sourceStatus, loading = false, freshness, testId }: Props) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  const statusLabel = loading
    ? t('admin.operationalSummary.loading', 'Loading sources')
    : sourceStatus === 'refreshing'
      ? t('admin.operationalSummary.refreshing', 'Refreshing sources')
      : sourceStatus === 'stale'
      ? t('admin.operationalSummary.retained', 'Retained measurements')
      : sourceStatus === 'error' || sourceStatus === 'offline' || sourceStatus === 'initialFailure' || sourceStatus === 'unavailable'
        ? t('admin.operationalSummary.unavailable', 'Source unavailable')
        : sourceStatus === 'partial'
          ? t('admin.operationalSummary.partial', 'Independent source availability')
          : sourceStatus === 'empty'
            ? t('admin.operationalSummary.empty', 'Empty source')
            : sourceStatus === 'initial'
              ? t('admin.operationalSummary.unknown', 'Source not loaded')
              : t('admin.operationalSummary.loaded', 'Sources loaded');
  return <OperationalBrief compact testId={testId} metrics={operationalMetrics}
    eyebrow={eyebrow} title={title} description={description}
    statusLabel={statusLabel}
    statusTone={sourceStatus === 'error' || sourceStatus === 'offline' || sourceStatus === 'initialFailure' ? 'danger'
      : sourceStatus === 'stale' || sourceStatus === 'partial' || sourceStatus === 'unavailable' ? 'warning' : 'neutral'}
    loading={loading} scope={<Text as="span" variant="caption">{scope}</Text>}
    freshness={freshness} provenance={description} />;
}
