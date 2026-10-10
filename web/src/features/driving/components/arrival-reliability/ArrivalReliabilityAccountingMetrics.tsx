import { useTranslation } from 'react-i18next';


import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityEvidenceMetricGroup,
  type ArrivalReliabilityEvidenceMetric,
} from './ArrivalReliabilityEvidenceMetricGroup';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ArrivalReliabilityAccountingMetricsProps {
  analysis: ArrivalReliabilityResult;
}

export function ArrivalReliabilityAccountingMetrics({
  analysis,
}: ArrivalReliabilityAccountingMetricsProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const accounting = analysis.accounting;
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.returned', 'Rows returned'),
      metricId: 'count', rawValue: accounting.returnedRows,
      displayValue: fmtInt(accounting.returnedRows),
    },
    {
      label: t('arrivalReliability.quality.included', 'Included drives'),
      metricId: 'count', rawValue: accounting.includedRows,
      displayValue: fmtInt(accounting.includedRows),
    },
    {
      label: t('arrivalReliability.quality.excluded', 'Excluded rows'),
      metricId: 'count', rawValue: accounting.excludedRows,
      displayValue: fmtInt(accounting.excludedRows),
    },
    {
      label: t('arrivalReliability.quality.incomplete', 'Incomplete timestamps'),
      metricId: 'count', rawValue: accounting.incompleteRows,
      displayValue: fmtInt(accounting.incompleteRows),
    },
    {
      label: t(
        'arrivalReliability.quality.invalidOrder',
        'Invalid timestamps or end order',
      ),
      metricId: 'count', rawValue: accounting.invalidTimestampOrOrderRows,
      displayValue: fmtInt(accounting.invalidTimestampOrOrderRows),
    },
    {
      label: t('arrivalReliability.quality.future', 'Future rows'),
      metricId: 'count', rawValue: accounting.futureRows,
      displayValue: fmtInt(accounting.futureRows),
    },
    {
      label: t(
        'arrivalReliability.quality.invalidDuration',
        'Invalid or nonpositive duration',
      ),
      metricId: 'count', rawValue: accounting.invalidDurationRows,
      displayValue: fmtInt(accounting.invalidDurationRows),
    },
    {
      label: t('arrivalReliability.quality.unlocatable', 'Unlocatable rows'),
      metricId: 'count', rawValue: accounting.unlocatableRows,
      displayValue: fmtInt(accounting.unlocatableRows),
    },
    {
      label: t('arrivalReliability.quality.historyCap', 'History cap state'),
      metricId: 'status',
      rawValue: accounting.historyCapReached
        ? t('arrivalReliability.quality.capReachedValue', 'Reached')
        : t('arrivalReliability.quality.capBelowValue', 'Not reached'),
    },
  ];

  return (
    <ArrivalReliabilityEvidenceMetricGroup
      title={t(
        'arrivalReliability.quality.accountingTitle',
        'Mutually exclusive returned-row accounting',
      )}
      metrics={metrics}
      testId="arrival-row-accounting-brief"
    />
  );
}
