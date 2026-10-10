import { useTranslation } from 'react-i18next';
import { NestedDrivingBrief, type NestedDrivingMetric } from '../operationalbrief-a-m/NestedDrivingBrief';

export type DestinationTransitionsEvidenceMetric = NestedDrivingMetric;

interface DestinationTransitionsMetricGroupProps {
  title: string;
  metrics: DestinationTransitionsEvidenceMetric[];
  testId: string;
}

export function DestinationTransitionsMetricGroup({
  title,
  metrics,
  testId,
}: DestinationTransitionsMetricGroupProps) {
  const { t } = useTranslation();
  const description = t('destinationTransitions.quality.briefDescription', 'Loaded visits and accepted adjacent pairs define this evidence. Entropy and weighted support are descriptive, not predicted destinations or continuous observation.');
  return <NestedDrivingBrief title={title} metrics={metrics} description={description}
    period={{ kind: 'unknown', label: t('destinationTransitions.quality.briefScope', 'Loaded completed visits and accepted transition population; source timestamps, configuration and denominators are shown separately.'), reason: description }}
    testId={testId} />;
}
