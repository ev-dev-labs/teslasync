import { useTranslation } from 'react-i18next';

import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';

interface DestinationContinuityMetricsProps {
  model: DestinationTransitionResult;
  locale: string;
}

export function DestinationContinuityMetrics({
  model,
  locale,
}: DestinationContinuityMetricsProps) {
  const { t } = useTranslation();
  const continuity = model.continuity;
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.pairs.candidates',
        'Adjacent candidate pairs',
      ),
      value: fmtInt(continuity.adjacentCandidatePairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.accepted',
        'Accepted transitions',
      ),
      value: fmtInt(continuity.acceptedTransitions),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.excluded',
        'Excluded pairs',
      ),
      value: fmtInt(continuity.excludedPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.unusable',
        'Unusable row or indeterminate chronology',
      ),
      value: fmtInt(continuity.excludedUnusableRowPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.startUnknown',
        'Current start unlocatable',
      ),
      value: fmtInt(continuity.excludedCurrentStartUnlocatablePairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.mismatch',
        'Endpoint mismatch',
      ),
      value: fmtInt(continuity.excludedEndpointMismatchPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.overlap',
        'Overlap or negative gap',
      ),
      value: fmtInt(continuity.excludedOverlapOrNegativeGapPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.longGap',
        'Configured long-gap exclusions',
      ),
      value: fmtInt(continuity.excludedLongGapPairs),
    },
    {
      label: t(
        'destinationTransitions.quality.pairs.tolerance',
        'GPS continuity tolerance',
      ),
      value: t(
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
      value:
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
                  1,
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
    />
  );
}
