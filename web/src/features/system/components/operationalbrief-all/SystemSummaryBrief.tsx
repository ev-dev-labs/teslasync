import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OperationalBrief, type OperationalBriefMetric, type OperationalTone } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface SystemSummaryBriefProps {
  title: string;
  description: string;
  scope: ReactNode;
  metrics: readonly StatMetric[];
  textMetrics?: readonly OperationalBriefMetric[];
  loading?: boolean;
  available: boolean;
  retained?: boolean;
  statusLabel?: string;
  freshness?: ReactNode;
  testId?: string;
  metricTones?: Readonly<Record<string, OperationalTone>>;
}

export function SystemSummaryBrief({
  title, description, scope, metrics, textMetrics = [], loading = false,
  available, retained = false, statusLabel, freshness, testId, metricTones,
}: SystemSummaryBriefProps) {
  const { t } = useTranslation();
  const values = useOperationalMetrics(metrics);
  const observation = freshness ?? t('system.brief.freshnessUnknown', 'Source observation time not supplied');
  const status = loading
    ? t('system.brief.loading', 'Loading source')
    : retained
      ? t('system.brief.retained', 'Retained source')
      : available
        ? t('system.brief.available', 'Source available')
        : t('system.brief.unavailable', 'Source unavailable');

  return (
    <OperationalBrief
      compact
      eyebrow={t('system.brief.eyebrow', 'System evidence')}
      title={title}
      description={description}
      statusLabel={statusLabel ? `${status} · ${statusLabel}` : status}
      statusTone={retained || !available ? 'warning' : 'neutral'}
      metrics={[...values.map(metric => ({ ...metric, tone: metricTones?.[metric.key] })), ...textMetrics]}
      scope={scope}
      freshness={observation}
      provenance={description}
      narrative={{
        whatChanged: description, whyItMatters: null,
        confidence: { label: 'not_scored', score: null, basis: [] },
        likelyCause: null, recommendedResponse: null,
        limitations: [
          ...(typeof scope === 'string' ? [scope] : []),
          ...(typeof observation === 'string' ? [observation] : []),
        ],
        evidence: [], provenance: [{ source: description }],
      }}
      loading={loading}
      testId={testId}
    />
  );
}
