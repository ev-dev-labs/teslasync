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

interface ArrivalReliabilitySupportMetricsProps {
  analysis: ArrivalReliabilityResult;
  locale: string;
}

export function ArrivalReliabilitySupportMetrics({
  analysis,
  locale,
}: ArrivalReliabilitySupportMetricsProps) {
  const { t } = useTranslation();
  const support = analysis.coverage.globalSupport;
  const metrics: ArrivalReliabilityEvidenceMetric[] = [
    {
      label: t('arrivalReliability.quality.supportBand', 'Global support band'),
      value: arrivalEvidenceBandLabel(t, support.band),
    },
    {
      label: t('arrivalReliability.quality.supportIndex', 'Global support index'),
      value: arrivalIndex(support.index, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.volumeIngredient',
        'Supported-drive volume ingredient',
      ),
      value: arrivalPercent(support.supportedDriveVolumeIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.routeIngredient',
        'Supported-route ingredient',
      ),
      value: arrivalPercent(support.supportedRouteIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.weekIngredient',
        'Active-week ingredient',
      ),
      value: arrivalPercent(support.activeWeekIngredient, locale),
    },
    {
      label: t(
        'arrivalReliability.quality.coverageIngredient',
        'Repeated-coverage ingredient',
      ),
      value: arrivalPercent(support.repeatedCoverageIngredient, locale),
    },
  ];

  return (
    <ArrivalReliabilityEvidenceMetricGroup
      title={t(
        'arrivalReliability.quality.supportTitle',
        'Transparent support ingredients',
      )}
      metrics={metrics}
    />
  );
}
