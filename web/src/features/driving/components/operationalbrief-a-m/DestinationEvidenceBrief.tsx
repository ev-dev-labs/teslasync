import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DestinationTransitionsKpiBand } from '../destination-transitions/DestinationTransitionsKpiBand';
import { DestinationTransitionsQueryStatus } from '../destination-transitions/DestinationTransitionsQueryStatus';
import { destinationBits, destinationIndex, destinationPercent } from '../destination-transitions/labels';
import { destinationKpiPendingText, destinationLatestKpiText } from '../destination-transitions/kpiLabels';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof DestinationTransitionsKpiBand>;

export function DestinationEvidenceBrief({ model, state, locale }: Props) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const ready = state.isResolved && !state.error;
  const pending = destinationKpiPendingText(t, state);
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'visits', rawValue: ready ? model.includedVisits : null,
      label: t('destinationTransitions.kpis.includedVisits', 'Included destination visits'),
      description: pending ?? t('destinationTransitions.kpis.returnedRows', '{{count}} rows returned', { count: model.accounting.returnedRows }) },
    { metricId: 'count', occurrenceId: 'transitions', rawValue: ready ? model.acceptedTransitions : null,
      label: t('destinationTransitions.kpis.acceptedTransitions', 'Accepted transitions'),
      description: pending ?? t('destinationTransitions.kpis.candidatePairs', '{{count}} adjacent candidate pairs', { count: model.continuity.adjacentCandidatePairs }) },
    { metricId: 'count', occurrenceId: 'destinations', rawValue: ready ? model.uniqueDestinations : null,
      label: t('destinationTransitions.kpis.uniqueDestinations', 'Unique destinations'),
      description: pending ?? t('destinationTransitions.kpis.normalizedStates', 'normalized end-location states') },
    { metricId: 'count', occurrenceId: 'origins', rawValue: ready ? model.evidence.supportedOriginStates : null,
      label: t('destinationTransitions.kpis.supportedOrigins', 'Supported origin states'),
      description: pending ?? t('destinationTransitions.kpis.supportedCoverage', '{{coverage}} of accepted transitions · at least 3 outgoing each',
        { coverage: destinationPercent(model.evidence.supportedOriginTransitionCoverage, locale) }) },
    { metricId: 'score', occurrenceId: 'concentration', rawValue: ready ? model.evidence.transitionConcentrationIndex : null,
      label: t('destinationTransitions.kpis.concentration', 'Transition concentration index'),
      description: pending ?? t('destinationTransitions.kpis.entropyDetail', '{{bits}} weighted entropy bits · {{effective}} effective successors',
        { bits: destinationBits(model.evidence.weightedEntropyBits, locale),
          effective: model.evidence.effectiveSuccessorCount != null ? fmtInt(model.evidence.effectiveSuccessorCount) : '—' }),
      display: { formatter: (raw) => ({ value: destinationIndex(raw, locale), unit: '' }) } },
    { metricId: 'text', occurrenceId: 'latest', rawValue: ready ? model.latestState?.label : null,
      label: t('destinationTransitions.kpis.latestDestination', 'Latest observed destination'),
      description: destinationLatestKpiText(t, model, ready, pending) },
  ];
  return <section aria-label={t('destinationTransitions.kpis.aria', 'Destination transition evidence summary')} data-testid="destination-transitions-kpis">
    <DrivingSummaryBrief metrics={metrics}
      title={t('destinationTransitions.kpis.title', 'Continuity-safe destination evidence')}
      description={t('destinationTransitions.brief.description', 'Accepted adjacent transitions retain chronology and continuity gates; historical successors describe past observations, not the next destination.')}
      scope={ready ? model.accounting.historyCapReached
        ? t('destinationTransitions.kpis.capReached', 'latest 1,000-row cap reached')
        : t('destinationTransitions.kpis.capNotReached', 'returned history below the 1,000-row cap')
        : t('driving.brief.unresolvedCoverage', 'Drive-history coverage is unresolved')}
      provenance={t('destinationTransitions.brief.source', 'Returned end-location states and accepted adjacent pairs; latest unusable rows are never replaced with older destinations.')}
      loading={state.isLoading} error={state.error} showError={false} retained={state.refreshError != null} onRetry={state.onRetry}
      statusLabel={!state.vehicleSelected ? t('driving.brief.selectVehicle', 'Select a vehicle') : undefined} />
    <DestinationTransitionsQueryStatus model={model} state={state} />
  </section>;
}
