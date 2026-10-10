import { useTranslation } from 'react-i18next';

import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import {
  ArrivalReliabilityEvidenceMetricGroup,
  type ArrivalReliabilityEvidenceMetric,
} from './ArrivalReliabilityEvidenceMetricGroup';
import {
  arrivalEvidenceBandLabel,
  arrivalIndex,
  arrivalPercent,
} from './labels';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ArrivalReliabilitySupportMetricsProps {
  analysis: ArrivalReliabilityResult;
  locale: string;
}

export function ArrivalReliabilitySupportMetrics({
  analysis,
  locale,
}: ArrivalReliabilitySupportMetricsProps) {
  useNumberFormatting();
  const { t } = useTranslation();
  const support = analysis.coverage.globalSupport;
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.supportBand', 'Global support band'),
      metricId: 'status', rawValue: arrivalEvidenceBandLabel(t, support.band),
    },
    {
      label: t('arrivalReliability.quality.supportIndex', 'Global support index'),
      metricId: 'score', rawValue: support.index,
      displayValue: arrivalIndex(support.index, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.volumeIngredient',
        'Supported-drive volume ingredient',
      ),
      metricId: 'percent', rawValue: support.supportedDriveVolumeIngredient != null ? support.supportedDriveVolumeIngredient * 100 : null,
      displayValue: arrivalPercent(support.supportedDriveVolumeIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.routeIngredient',
        'Supported-route ingredient',
      ),
      metricId: 'percent', rawValue: support.supportedRouteIngredient != null ? support.supportedRouteIngredient * 100 : null,
      displayValue: arrivalPercent(support.supportedRouteIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.weekIngredient',
        'Active-week ingredient',
      ),
      metricId: 'percent', rawValue: support.activeWeekIngredient != null ? support.activeWeekIngredient * 100 : null,
      displayValue: arrivalPercent(support.activeWeekIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.coverageIngredient',
        'Repeated-coverage ingredient',
      ),
      metricId: 'percent', rawValue: support.repeatedCoverageIngredient != null ? support.repeatedCoverageIngredient * 100 : null,
      displayValue: arrivalPercent(support.repeatedCoverageIngredient, locale),
    },
  ];

  return (
    <ArrivalReliabilityEvidenceMetricGroup
      title={t(
        'arrivalReliability.quality.supportTitle',
        'Transparent support ingredients',
      )}
      metrics={metrics}
      testId="arrival-support-ingredients-brief"
    />
  );
}
