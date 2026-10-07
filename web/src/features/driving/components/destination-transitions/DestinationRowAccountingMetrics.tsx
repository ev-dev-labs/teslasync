import { useTranslation } from 'react-i18next';

import { fmtInt } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';

interface DestinationRowAccountingMetricsProps {
  model: DestinationTransitionResult;
}

export function DestinationRowAccountingMetrics({
  model,
}: DestinationRowAccountingMetricsProps) {
  const { t } = useTranslation();
  const accounting = model.accounting;
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.rows.returned',
        'Rows returned',
      ),
      value: fmtInt(accounting.returnedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.included',
        'Included completed visits',
      ),
      value: fmtInt(accounting.includedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.excluded',
        'Excluded rows',
      ),
      value: fmtInt(accounting.excludedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.incomplete',
        'Incomplete timestamps or completion',
      ),
      value: fmtInt(accounting.incompleteTimestampRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.invalidOrder',
        'Invalid timestamp or end order',
      ),
      value: fmtInt(accounting.invalidTimestampOrOrderRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.future',
        'Future rows',
      ),
      value: fmtInt(accounting.futureRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.invalidDuration',
        'Invalid or nonpositive duration',
      ),
      value: fmtInt(accounting.invalidDurationRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.unlocatable',
        'Unlocatable end destination',
      ),
      value: fmtInt(accounting.unlocatableEndDestinationRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.placed',
        'Chronologically placed rows',
      ),
      value: fmtInt(accounting.chronologicallyPlacedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.unplaced',
        'Rows with unplaceable start',
      ),
      value: fmtInt(accounting.unplacedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.cap',
        'History cap state',
      ),
      value: accounting.historyCapReached
        ? t(
            'destinationTransitions.quality.rows.capReached',
            'Reached',
          )
        : t(
            'destinationTransitions.quality.rows.capBelow',
            'Not reached',
          ),
    },
  ];

  return (
    <DestinationTransitionsMetricGroup
      title={t(
        'destinationTransitions.quality.rows.title',
        'Mutually exclusive returned-row accounting',
      )}
      metrics={metrics}
    />
  );
}
