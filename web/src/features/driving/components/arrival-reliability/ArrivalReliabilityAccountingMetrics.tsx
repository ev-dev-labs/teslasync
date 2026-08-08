import { useTranslation } from 'react-i18next';

import { fmtInt } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityEvidenceMetricGroup,
  type ArrivalReliabilityEvidenceMetric,
} from './ArrivalReliabilityEvidenceMetricGroup';

interface ArrivalReliabilityAccountingMetricsProps {
  analysis: ArrivalReliabilityResult;
}

export function ArrivalReliabilityAccountingMetrics({
  analysis,
}: ArrivalReliabilityAccountingMetricsProps) {
  const { t } = useTranslation();
  const accounting = analysis.accounting;
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.returned', 'Rows returned'),
      value: fmtInt(accounting.returnedRows),
    },
    {
      label: t('arrivalReliability.quality.included', 'Included drives'),
      value: fmtInt(accounting.includedRows),
    },
    {
      label: t('arrivalReliability.quality.excluded', 'Excluded rows'),
      value: fmtInt(accounting.excludedRows),
    },
    {
      label: t('arrivalReliability.quality.incomplete', 'Incomplete timestamps'),
      value: fmtInt(accounting.incompleteRows),
    },
    {
      label: t(
        'arrivalReliability.quality.invalidOrder',
        'Invalid timestamps or end order',
      ),
      value: fmtInt(accounting.invalidTimestampOrOrderRows),
    },
    {
      label: t('arrivalReliability.quality.future', 'Future rows'),
      value: fmtInt(accounting.futureRows),
    },
    {
      label: t(
        'arrivalReliability.quality.invalidDuration',
        'Invalid or nonpositive duration',
      ),
      value: fmtInt(accounting.invalidDurationRows),
    },
    {
      label: t('arrivalReliability.quality.unlocatable', 'Unlocatable rows'),
      value: fmtInt(accounting.unlocatableRows),
    },
    {
      label: t('arrivalReliability.quality.historyCap', 'History cap state'),
      value: accounting.historyCapReached
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
    />
  );
}
