import { useTranslation } from 'react-i18next';


import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  DestinationTransitionsMetricGroup,
  type DestinationTransitionsEvidenceMetric,
} from './DestinationTransitionsMetricGroup';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface DestinationRowAccountingMetricsProps {
  model: DestinationTransitionResult;
}

export function DestinationRowAccountingMetrics({
  model,
}: DestinationRowAccountingMetricsProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const accounting = model.accounting;
  const metrics: DestinationTransitionsEvidenceMetric[] = [
    {
      label: t(
        'destinationTransitions.quality.rows.returned',
        'Rows returned',
      ),
      metricId: 'count', rawValue: accounting.returnedRows,
      displayValue: fmtInt(accounting.returnedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.included',
        'Included completed visits',
      ),
      metricId: 'count', rawValue: accounting.includedRows,
      displayValue: fmtInt(accounting.includedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.excluded',
        'Excluded rows',
      ),
      metricId: 'count', rawValue: accounting.excludedRows,
      displayValue: fmtInt(accounting.excludedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.incomplete',
        'Incomplete timestamps or completion',
      ),
      metricId: 'count', rawValue: accounting.incompleteTimestampRows,
      displayValue: fmtInt(accounting.incompleteTimestampRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.invalidOrder',
        'Invalid timestamp or end order',
      ),
      metricId: 'count', rawValue: accounting.invalidTimestampOrOrderRows,
      displayValue: fmtInt(accounting.invalidTimestampOrOrderRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.future',
        'Future rows',
      ),
      metricId: 'count', rawValue: accounting.futureRows,
      displayValue: fmtInt(accounting.futureRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.invalidDuration',
        'Invalid or nonpositive duration',
      ),
      metricId: 'count', rawValue: accounting.invalidDurationRows,
      displayValue: fmtInt(accounting.invalidDurationRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.unlocatable',
        'Unlocatable end destination',
      ),
      metricId: 'count', rawValue: accounting.unlocatableEndDestinationRows,
      displayValue: fmtInt(accounting.unlocatableEndDestinationRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.placed',
        'Chronologically placed rows',
      ),
      metricId: 'count', rawValue: accounting.chronologicallyPlacedRows,
      displayValue: fmtInt(accounting.chronologicallyPlacedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.unplaced',
        'Rows with unplaceable start',
      ),
      metricId: 'count', rawValue: accounting.unplacedRows,
      displayValue: fmtInt(accounting.unplacedRows),
    },
    {
      label: t(
        'destinationTransitions.quality.rows.cap',
        'History cap state',
      ),
      metricId: 'status',
      rawValue: accounting.historyCapReached
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
      testId="destination-row-accounting-brief"
    />
  );
}
