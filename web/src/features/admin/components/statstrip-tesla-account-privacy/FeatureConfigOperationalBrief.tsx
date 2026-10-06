import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { DataStatus } from '@/api/dataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { FeatureFlagSummary } from '../tesla-feature-flags/parseFeatureFlags';
import { useAccountSnapshotPeriod } from './useAccountSnapshotPeriod';
import { useAccountBriefStatus } from './useAccountBriefStatus';

interface FeatureConfigOperationalBriefProps {
  summary: FeatureFlagSummary | null;
  fetchedAt: string | null;
  loading: boolean;
  sourceStatus: DataStatus;
}

export function FeatureConfigOperationalBrief({ summary, fetchedAt, loading, sourceStatus }: FeatureConfigOperationalBriefProps) {
  const { t } = useTranslation();
  const period = useAccountSnapshotPeriod(fetchedAt);
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'features-total', rawValue: summary?.total,
      label: t('featureConfig.kpi.total', 'Total features') },
    { metricId: 'count', occurrenceId: 'features-enabled', rawValue: summary?.enabled,
      label: t('featureConfig.kpi.enabled', 'Enabled') },
    { metricId: 'count', occurrenceId: 'features-disabled', rawValue: summary?.disabled,
      label: t('featureConfig.kpi.disabled', 'Disabled') },
    { metricId: 'percent', occurrenceId: 'features-enabled-rate', rawValue: summary?.enabledRate,
      label: t('featureConfig.kpi.enabledRate', 'Enabled rate') },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const status = useAccountBriefStatus(sourceStatus);
  return <OperationalBrief compact testId="tesla-feature-config-summary" metrics={briefMetrics}
    eyebrow={t('teslaAccount.brief.eyebrow', 'Tesla account')}
    title={t('featureConfig.brief.title', 'Account feature configuration')}
    description={t('featureConfig.brief.description', 'Enabled and disabled features in the latest Tesla account configuration.')}
    {...status} loading={loading}
    scope={<Text as="span" variant="caption">{period.label}</Text>}
    provenance={period.kind === 'snapshot' ? period.provenance : undefined} />;
}
