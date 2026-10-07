import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';

interface OwnershipBriefMetric extends StatMetric {
  tone?: 'default' | 'positive' | 'warning' | 'critical' | 'accent';
}

interface OwnershipBriefProps {
  title: string;
  description: string;
  scope: ReactNode;
  metrics: readonly OwnershipBriefMetric[];
  source: DataStateSource<unknown>;
  enabled?: boolean;
  window?: { from: string; to: string };
  observedAt?: string;
}

export function OwnershipBrief({
  title, description, scope, metrics, source, enabled = true, window, observedAt,
}: OwnershipBriefProps) {
  const { t } = useTranslation();
  const state = useDataState(source);
  const operationalMetrics = useOperationalMetrics(metrics.map((metric) => ({
    ...metric, description: metric.description ?? title,
  })));
  const tones = {
    default: 'neutral', positive: 'success', warning: 'warning',
    critical: 'danger', accent: 'info',
  } as const;
  const statusLabel = !enabled
    ? t('ownership.brief.selectionRequired', 'Selection required')
    : state.fatalError
      ? t('ownership.brief.unavailable', 'Source unavailable')
      : state.status === 'stale'
        ? t('ownership.brief.retained', 'Retained source')
        : !state.hasData
          ? source.isLoading || source.isPending
            ? t('ownership.brief.loading', 'Loading source')
            : t('ownership.brief.notComputed', 'Not computed')
          : state.isRefreshing
            ? t('ownership.brief.refreshing', 'Refreshing source')
            : t('ownership.brief.returned', 'Source returned');

  return (
    <OperationalBrief
      compact
      eyebrow={t('ownership.brief.eyebrow', 'Ownership evidence')}
      title={title}
      description={description}
      statusLabel={statusLabel}
      statusTone={state.fatalError ? 'danger' : state.status === 'stale' ? 'warning' : 'neutral'}
      scope={<>
        <span>{scope}</span>
        <span>{window?.from && window.to
          ? t('ownership.brief.bounds', 'Recorded bounds {{from}} → {{to}}', {
              from: formatDateTime(window.from), to: formatDateTime(window.to),
            })
          : t('ownership.brief.boundsUnknown', 'Recorded analysis bounds not supplied')}</span>
      </>}
      freshness={<>
        <span>{observedAt
          ? t('ownership.brief.observedAt', 'Source as of {{date}}', { date: formatDateTime(observedAt) })
          : t('ownership.brief.freshnessUnknown', 'Source freshness unknown')}</span>
        {state.updatedAt != null && <span>{t('ownership.brief.loadedAt', 'Client loaded {{date}}', {
          date: formatDateTime(new Date(state.updatedAt).toISOString()),
        })}</span>}
      </>}
      provenance={t('ownership.brief.provenance', 'Returned source values; model assumptions and limitations remain in the evidence below.')}
      loading={enabled && !state.hasData && Boolean(source.isLoading || source.isPending)}
      metrics={operationalMetrics.map((metric, index) => ({
        ...metric, tone: metric.valueState === 'value' ? tones[metrics[index].tone ?? 'default'] : 'neutral',
      }))}
    />
  );
}
