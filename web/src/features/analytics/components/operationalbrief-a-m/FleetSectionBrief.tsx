import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { FleetAnalyticsQuery } from '../analytics/constants';

interface FleetSectionBriefProps {
  query: FleetAnalyticsQuery;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  scope?: string;
}

export function FleetSectionBrief({ query, title, description, metrics, scope }: FleetSectionBriefProps) {
  const { t } = useTranslation();
  const operationalMetrics = useOperationalMetrics(metrics);
  const loading = query.isLoading && query.data == null;
  const unavailable = query.data == null;
  const retained = query.data != null && (query.fetchStatus === 'paused' || query.isError);

  return (
    <OperationalBrief
      compact
      metrics={operationalMetrics}
      loading={loading}
      eyebrow={t('analytics.title', 'Fleet analytics')}
      title={title}
      description={description}
      statusLabel={loading ? t('analytics.brief.loading', 'Loading evidence')
        : unavailable ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : retained ? t('analytics.brief.retained', 'Retained evidence')
            : query.isFetching ? t('analytics.brief.refreshing', 'Updating evidence')
              : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={unavailable || retained ? 'warning' : 'neutral'}
      scope={scope ?? t('analytics.brief.sectionScope', 'Returned aggregates for the selected fleet range; exact recording coverage is unknown.')}
      provenance={t('analytics.brief.sectionProvenance', 'The fleet response does not supply an observation timestamp for these aggregates.')}
    />
  );
}
