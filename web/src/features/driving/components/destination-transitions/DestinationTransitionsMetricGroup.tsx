import { useTranslation } from 'react-i18next';
import { NestedDrivingBrief, type NestedDrivingMetric } from '../operationalbrief-a-m/NestedDrivingBrief';
import type { DestinationTransitionsQueryState } from './types';

export type DestinationTransitionsEvidenceMetric = NestedDrivingMetric;

interface DestinationTransitionsMetricGroupProps {
  title: string;
  metrics: DestinationTransitionsEvidenceMetric[];
  testId: string;
  state: DestinationTransitionsQueryState;
}

export function DestinationTransitionsMetricGroup({
  title,
  metrics,
  testId,
  state,
}: DestinationTransitionsMetricGroupProps) {
  const { t } = useTranslation();
  const ready = state.vehicleSelected && state.isResolved && !state.error;
  const retained = ready && (state.refreshError != null
    || state.sourceTrust?.status === 'stale' || state.sourceTrust?.isRefreshing === true);
  const sourceMetrics = ready ? metrics : metrics.map(({ displayValue: _displayValue, ...metric }) => ({
    ...metric,
    rawValue: null,
  }));
  const description = t('destinationTransitions.quality.briefDescription', 'Loaded visits and accepted adjacent pairs define this evidence. Entropy and weighted support are descriptive, not predicted destinations or continuous observation.');
  return <NestedDrivingBrief title={title} metrics={sourceMetrics} description={description}
    loading={state.isLoading && !ready} retained={retained} unavailable={!ready && !state.isLoading}
    period={{ kind: 'unknown', label: t('destinationTransitions.quality.briefScope', 'Loaded completed visits and accepted transition population; source timestamps, configuration and denominators are shown separately.'), reason: description }}
    testId={testId} />;
}
