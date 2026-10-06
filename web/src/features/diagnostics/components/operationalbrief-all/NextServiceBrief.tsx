import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface NextServiceBriefProps {
  state: DataState<unknown>;
  loading: boolean;
  noVehicle: boolean;
  componentLabel: string | null;
  projectedDate: string | null;
}

export function NextServiceBrief({
  state, loading, noVehicle, componentLabel, projectedDate,
}: NextServiceBriefProps) {
  const { t } = useTranslation();
  const available = !noVehicle && state.hasData;
  const projected = available && projectedDate != null;
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'rul-next-service-component',
      rawValue: projected ? componentLabel : null,
      label: t('rul.nextService.component', 'Service component'),
      description: t('rul.nextService.source', 'Existing next-service projection from the component health board.'),
    },
    {
      metricId: 'text', occurrenceId: 'rul-next-service-date',
      rawValue: projected ? projectedDate : null,
      label: t('rul.card.replaceBy', 'Replace by'),
      context: t('rul.nextService.by', 'projected by'),
      description: t('rul.nextService.assumption', 'Projected service date, not a guaranteed failure date; component forecasts retain their own confidence and basis below.'),
    },
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const retained = state.refreshError != null || state.isRefreshBlocked;
  const description = noVehicle ? t('rul.selectVehicle', 'Select a vehicle to view its component prognostics.')
    : state.fatalError ? t('rul.nextService.error', 'Unable to load service projection.')
      : projected ? `${componentLabel} — ${t('rul.nextService.by', 'projected by')} ${projectedDate}`
        : available ? t('rul.nextService.none', 'No upcoming service projected — all components healthy.')
          : t('rul.nextService.unavailable', 'Service projection unavailable.');

  return (
    <OperationalBrief
      compact
      testId="rul-next-service-summary"
      eyebrow={t('rul.title', 'Remaining useful life')}
      title={t('rul.nextService.title', 'Next service due')}
      description={description}
      metrics={briefMetrics}
      loading={loading && !state.hasData && !noVehicle}
      statusLabel={noVehicle ? t('rul.nextService.chooseVehicle', 'Choose a vehicle')
        : loading && !state.hasData ? t('common.loading', 'Loading')
          : state.fatalError ? t('error.loadFailed', 'Failed to load data')
            : retained ? t('developerReference.stats.state.retained', 'Showing retained measurements')
              : available ? t('rul.nextService.available', 'Component board available')
                : t('rul.nextService.unavailable', 'Service projection unavailable.')}
      statusTone={state.fatalError ? 'danger' : retained ? 'warning' : 'neutral'}
      scope={t('rul.nextService.scope', 'Selected vehicle · component health board')}
      freshness={t('rul.nextService.freshness', 'Board snapshot; no observation timestamp supplied')}
      provenance={t('rul.nextService.source', 'Existing next-service projection from the component health board.')}
    />
  );
}
