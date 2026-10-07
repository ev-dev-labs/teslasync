import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatMetric } from '@/components/data-display/stat-reference';
import { EmptyState } from '@/components/feedback';
import { DrivingSummaryBrief } from '../operationalbrief-a-m/DrivingSummaryBrief';
import type { ExplorerSummary } from '../../lib/explorer';
import type {
  ExplorerDistanceDisplay,
  ExplorerSectionState,
} from './types';

interface ExplorerKpisProps extends ExplorerDistanceDisplay {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  retained?: boolean;
}

export function ExplorerKpis({
  summary,
  state,
  formatDistance,
  retained = false,
}: ExplorerKpisProps) {
  const { t } = useTranslation();
  const base = summary.inferredBase;
  const available = !state.isLoading && state.error == null;
  const farthestName =
    summary.farthest?.label ??
    (summary.farthest
      ? t('explorer.kpi.farthest.unnamed', 'Unnamed destination')
      : undefined);

  const metrics: readonly StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'observed-destinations',
      rawValue: available ? summary.uniquePlaces : null,
      label: t('explorer.kpi.destinations.label', 'Observed destinations'),
      description: available
        ? t('explorer.kpi.destinations.subtitle', '{{count}} eligible located arrivals',
            { count: summary.eligibility.eligible })
        : t('explorer.brief.pending', 'Located-arrival evidence is not available yet.'),
    },
    {
      metricId: 'distance', occurrenceId: 'p90-radius',
      rawValue: available ? summary.radiusM : null,
      label: t('explorer.kpi.radius.label', 'P90 roaming radius'),
      description: summary.evidence.baseSufficient
        ? t('explorer.kpi.radius.subtitle', '90% of non-base arrivals are within this distance')
        : t('explorer.kpi.radius.insufficient', 'Needs a repeated observed base'),
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) },
    },
    {
      metricId: 'distance', occurrenceId: 'farthest-destination',
      rawValue: available ? summary.farthest?.distanceFromBaseM : null,
      label: t('explorer.kpi.farthest.label', 'Farthest observed destination'),
      description: t('explorer.brief.farthestContext', 'Distance from the inferred observed base.'),
      context: farthestName,
      display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) },
    },
    {
      metricId: 'text', occurrenceId: 'inferred-base',
      rawValue: available && base
        ? base.label ?? t('explorer.kpi.base.unnamed', 'Unnamed arrival cluster')
        : null,
      label: t('explorer.kpi.base.label', 'Inferred observed base'),
      description: base
        ? t('explorer.kpi.base.subtitle', '{{count}} arrivals; inferred, not a verified home',
            { count: base.visits })
        : t('explorer.kpi.radius.insufficient', 'Needs a repeated observed base'),
    },
  ];
  return (
    <section
      aria-label={t('explorer.kpis', 'Explorer summary metrics')}
      data-testid="explorer-kpis"
    >
      <DrivingSummaryBrief
        metrics={metrics}
        title={t('explorer.kpis', 'Explorer summary metrics')}
        description={t('explorer.brief.description', 'Located arrivals describe observed roaming, not complete travel history or a verified home.')}
        scope={summary.historyCapReached
          ? t('explorer.brief.capped', 'Latest {{count}} returned drives; history cap reached', { count: summary.historyLimit })
          : t('explorer.brief.window', 'Returned drive history; complete-history coverage is unknown')}
        provenance={t('explorer.brief.source', 'Drive-history arrival clusters; visit-weighted P90 distance from the inferred base.')}
        loading={state.isLoading}
        error={state.error}
        retained={retained}
        onRetry={state.onRetry}
      />
      {available && summary.eligibility.observed === 0 ? (
        <EmptyState
          className="py-6"
          icon={<Compass className="h-8 w-8" aria-hidden="true" />}
          message={t('explorer.kpi.empty', 'No drives were returned in this observed history window.')}
          actionTo={{ label: t('explorer.browseDrives', 'Browse drives'), to: '/drives' }}
        />
      ) : null}
    </section>
  );
}
