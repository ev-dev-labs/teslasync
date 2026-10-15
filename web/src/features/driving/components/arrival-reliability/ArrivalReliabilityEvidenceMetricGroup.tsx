import { useTranslation } from 'react-i18next';
import { NestedDrivingBrief, type NestedDrivingMetric } from '../operationalbrief-a-m/NestedDrivingBrief';

export type ArrivalReliabilityEvidenceMetric = NestedDrivingMetric;

interface ArrivalReliabilityEvidenceMetricGroupProps {
  title: string;
  metrics: ArrivalReliabilityEvidenceMetric[];
  testId: string;
  retained?: boolean;
}

export function ArrivalReliabilityEvidenceMetricGroup({
  title,
  metrics,
  testId,
  retained = false,
}: ArrivalReliabilityEvidenceMetricGroupProps) {
  const { t } = useTranslation();
  const description = t('arrivalReliability.quality.briefDescription', 'Loaded-drive accounting and recurrence are descriptive evidence. Support indices are not confidence scores or proof of continuous recording.');
  return <NestedDrivingBrief title={title} metrics={metrics} description={description}
    period={{ kind: 'unknown', label: t('arrivalReliability.quality.briefScope', 'Loaded completed-drive population; source timestamps and denominators are shown separately.'), reason: description }}
    testId={testId} retained={retained} />;
}
