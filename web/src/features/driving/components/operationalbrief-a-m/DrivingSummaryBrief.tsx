import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { MetricPreferences } from '@/lib/metric-reference';

interface DrivingSummaryBriefProps {
  metrics: readonly StatMetric[];
  title: string;
  eyebrow?: string;
  description: string;
  scope: ReactNode;
  provenance: string;
  loading?: boolean;
  error?: unknown;
  retained?: boolean;
  onRetry: () => void;
  testId?: string;
  statusLabel?: string;
  preferences?: MetricPreferences;
  showError?: boolean;
}

export function DrivingSummaryBrief({
  metrics, title, eyebrow, description, scope, provenance, loading = false,
  error, retained = false, onRetry, testId, statusLabel, preferences, showError = true,
}: DrivingSummaryBriefProps) {
  const { t } = useTranslation();
  const values = useOperationalMetrics(metrics, preferences);
  return <>
    <OperationalBrief compact
      eyebrow={eyebrow ?? t('driving.brief.eyebrow', 'Driving evidence')}
      title={title}
      description={description}
      scope={scope}
      provenance={provenance}
      loading={loading}
      statusLabel={statusLabel ?? (error
        ? t('driving.brief.unavailable', 'Source unavailable')
        : loading
          ? t('driving.brief.loading', 'Loading evidence')
          : retained
            ? t('driving.brief.retained', 'Retained evidence')
            : t('driving.brief.returned', 'Returned evidence'))}
      statusTone={error ? 'danger' : retained ? 'warning' : 'neutral'}
      metrics={values}
      testId={testId}
    />
    {showError && error != null && <QueryError error={error} onRetry={onRetry} />}
  </>;
}
