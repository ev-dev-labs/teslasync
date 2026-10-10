import { useTranslation } from 'react-i18next';


import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DestinationContinuityMetricsProps {
  model: DestinationTransitionResult;
  locale: string;
}

export function DestinationContinuityMetrics({
  model,
  locale,
}: DestinationContinuityMetricsProps) {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const continuity = model.continuity;
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.pairs.candidates',
        'Adjacent candidate pairs',
      ),
      metricId: 'count', rawValue: continuity.adjacentCandidatePairs,
      displayValue: fmtInt(continuity.adjacentCandidatePairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.accepted',
        'Accepted transitions',
      ),
      metricId: 'count', rawValue: continuity.acceptedTransitions,
      displayValue: fmtInt(continuity.acceptedTransitions),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.excluded',
        'Excluded pairs',
      ),
      metricId: 'count', rawValue: continuity.excludedPairs,
      displayValue: fmtInt(continuity.excludedPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.unusable',
        'Unusable row or indeterminate chronology',
      ),
      metricId: 'count', rawValue: continuity.excludedUnusableRowPairs,
      displayValue: fmtInt(continuity.excludedUnusableRowPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.startUnknown',
        'Current start unlocatable',
      ),
      metricId: 'count', rawValue: continuity.excludedCurrentStartUnlocatablePairs,
      displayValue: fmtInt(continuity.excludedCurrentStartUnlocatablePairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.mismatch',
        'Endpoint mismatch',
      ),
      metricId: 'count', rawValue: continuity.excludedEndpointMismatchPairs,
      displayValue: fmtInt(continuity.excludedEndpointMismatchPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.overlap',
        'Overlap or negative gap',
      ),
      metricId: 'count', rawValue: continuity.excludedOverlapOrNegativeGapPairs,
      displayValue: fmtInt(continuity.excludedOverlapOrNegativeGapPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.longGap',
        'Configured long-gap exclusions',
      ),
      metricId: 'count', rawValue: continuity.excludedLongGapPairs,
      displayValue: fmtInt(continuity.excludedLongGapPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.tolerance',
        'GPS continuity tolerance',
      ),
      metricId: 'distance', rawValue: model.config.gpsToleranceM,
      displayValue: t(
        'destinationTransitions.quality.pairs.meters',
        '{{count}} m',
        { count: Math.round(model.config.gpsToleranceM) },
      ),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.maxGap',
        'Elapsed-time maximum',
      ),
      metricId: model.config.maxContinuityGapMs == null ? 'status' : 'duration',
      rawValue: model.config.maxContinuityGapMs == null
        ? t('destinationTransitions.quality.pairs.noMaxGap', 'Not configured')
        : model.config.maxContinuityGapMs / 1000,
      displayValue:
        model.config.maxContinuityGapMs == null
          ? t(
              'destinationTransitions.quality.pairs.noMaxGap',
              'Not configured',
            )
          : t(
              'destinationTransitions.quality.pairs.maxGapHours',
              '{{hours}} hours',
              {
                hours: fmtNumber(
                  model.config.maxContinuityGapMs / 3_600_000,
                  undefined,
                  locale,
                ),
              },
            ),
    },
  ];

  return (
    <DestinationTransitionsMetricGroup
      title={t(
        'destinationTransitions.quality.pairs.title',
        'Mutually exclusive adjacency and continuity accounting',
      )}
      metrics={metrics}
      testId="destination-continuity-accounting-brief"
    />
  );
}
