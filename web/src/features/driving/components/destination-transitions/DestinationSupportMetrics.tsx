import { useTranslation } from 'react-i18next';


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
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DestinationSupportMetricsProps {
  model: DestinationTransitionResult;
  locale: string;
}

export function DestinationSupportMetrics({
  model,
  locale,
}: DestinationSupportMetricsProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
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
      metricId: 'score', rawValue: evidence.transitionConcentrationIndex,
      displayValue: destinationIndex(
        evidence.transitionConcentrationIndex,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.entropy',
        'Weighted entropy bits',
      ),
      metricId: 'number', rawValue: evidence.weightedEntropyBits,
      displayValue: destinationBits(evidence.weightedEntropyBits, locale),
    },
    {
      label: t(
        'destinationTransitions.quality.support.effective',
        'Effective successor count',
      ),
      metricId: 'number', rawValue: evidence.effectiveSuccessorCount,
      description: t('destinationTransitions.quality.support.effectiveSource', 'Entropy-derived effective successors can be fractional; this is not a counted event population. The existing rounded display is retained.'),
      displayValue:
        evidence.effectiveSuccessorCount != null
          ? fmtInt(evidence.effectiveSuccessorCount, locale)
          : '—',
    },
    {
      label: t(
        'destinationTransitions.quality.support.stateConcentration',
        'Destination visit concentration',
      ),
      metricId: 'percent', rawValue: evidence.destinationVisitConcentration != null ? evidence.destinationVisitConcentration * 100 : null,
      displayValue: destinationPercent(
        evidence.destinationVisitConcentration,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.edgeConcentration',
        'Accepted edge concentration',
      ),
      metricId: 'percent', rawValue: evidence.acceptedEdgeConcentration != null ? evidence.acceptedEdgeConcentration * 100 : null,
      displayValue: destinationPercent(
        evidence.acceptedEdgeConcentration,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.supportIndex',
        'Weighted origin support index',
      ),
      metricId: 'score', rawValue: evidence.weightedOriginSupportIndex,
      displayValue: destinationIndex(
        evidence.weightedOriginSupportIndex,
        locale,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.volumeIngredient',
        'Outgoing-volume ingredient',
      ),
      metricId: 'percent', rawValue: evidence.weightedOutgoingTransitionIngredient != null ? evidence.weightedOutgoingTransitionIngredient * 100 : null,
      displayValue: ingredient(
        evidence.weightedOutgoingTransitionIngredient,
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.support.dayIngredient',
        'Active-day ingredient',
      ),
      metricId: 'percent', rawValue: evidence.weightedActiveDayIngredient != null ? evidence.weightedActiveDayIngredient * 100 : null,
      displayValue: ingredient(evidence.weightedActiveDayIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.weekIngredient',
        'Active-week ingredient',
      ),
      metricId: 'percent', rawValue: evidence.weightedActiveWeekIngredient != null ? evidence.weightedActiveWeekIngredient * 100 : null,
      displayValue: ingredient(evidence.weightedActiveWeekIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.recurrenceIngredient',
        'Recurrence ingredient',
      ),
      metricId: 'percent', rawValue: evidence.weightedRecurrenceIngredient != null ? evidence.weightedRecurrenceIngredient * 100 : null,
      displayValue: ingredient(evidence.weightedRecurrenceIngredient),
    },
    {
      label: t(
        'destinationTransitions.quality.support.latestAge',
        'Latest state age (days)',
      ),
      metricId: 'duration', rawValue: evidence.latestStateAgeDays != null ? evidence.latestStateAgeDays * 86400 : null,
      displayValue:
        evidence.latestStateAgeDays != null
          ? fmtNumber(evidence.latestStateAgeDays, undefined, locale)
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
      testId="destination-descriptive-support-brief"
    />
  );
}
