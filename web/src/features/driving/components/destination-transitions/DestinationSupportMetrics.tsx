import { useTranslation } from 'react-i18next';

import { fmtNumber } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationBits,
  destinationIndex,
  destinationPercent,
} from './labels';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';

interface DestinationSupportMetricsProps {
  model: DestinationTransitionResult;
  locale: string;
}

export function DestinationSupportMetrics({
  model,
  locale,
}: DestinationSupportMetricsProps) {
  const { t } = useTranslation();
  const evidence = model.evidence;
  const ingredient = (value: number | null) =>
    destinationPercent(value, locale);
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.support.concentration',
        'Transition concentration index',
      ),
      value: destinationIndex(
        evidence.transitionConcentrationIndex,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.entropy',
        'Weighted entropy bits',
      ),
      value: destinationBits(evidence.weightedEntropyBits, locale),
    },
    {
      label: t(
        'destinationTransitions.quality.support.effective',
        'Effective successor count',
      ),
      value:
        evidence.effectiveSuccessorCount != null
          ? fmtNumber(evidence.effectiveSuccessorCount, 2, locale)
          : '—',
    },
    {
      label: t(
        'destinationTransitions.quality.support.stateConcentration',
        'Destination visit concentration',
      ),
      value: destinationPercent(
        evidence.destinationVisitConcentration,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.edgeConcentration',
        'Accepted edge concentration',
      ),
      value: destinationPercent(
        evidence.acceptedEdgeConcentration,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.supportIndex',
        'Weighted origin support index',
      ),
      value: destinationIndex(
        evidence.weightedOriginSupportIndex,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.volumeIngredient',
        'Outgoing-volume ingredient',
      ),
      value: ingredient(
        evidence.weightedOutgoingTransitionIngredient,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.dayIngredient',
        'Active-day ingredient',
      ),
      value: ingredient(evidence.weightedActiveDayIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.weekIngredient',
        'Active-week ingredient',
      ),
      value: ingredient(evidence.weightedActiveWeekIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.recurrenceIngredient',
        'Recurrence ingredient',
      ),
      value: ingredient(evidence.weightedRecurrenceIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.latestAge',
        'Latest state age (days)',
      ),
      value:
        evidence.latestStateAgeDays != null
          ? fmtNumber(evidence.latestStateAgeDays, 1, locale)
          : '—',
    },
  ];

  return (
    <DestinationTransitionsMetricGroup
      title={t(
        'destinationTransitions.quality.support.title',
        'Descriptive shape and separate support ingredients',
      )}
      metrics={metrics}
    />
  );
}
