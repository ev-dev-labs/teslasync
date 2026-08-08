import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilityAccountingMetrics } from './ArrivalReliabilityAccountingMetrics';
import { ArrivalReliabilityCoverageMetrics } from './ArrivalReliabilityCoverageMetrics';
import { ArrivalReliabilitySupportMetrics } from './ArrivalReliabilitySupportMetrics';

interface ArrivalReliabilityEvidenceMetricsProps {
  analysis: ArrivalReliabilityResult;
  locale: string;
  timeZone: string;
}

export function ArrivalReliabilityEvidenceMetrics({
  analysis,
  locale,
  timeZone,
}: ArrivalReliabilityEvidenceMetricsProps) {
  return (
    <div className="space-y-5">
      <ArrivalReliabilityAccountingMetrics analysis={analysis} />
      <ArrivalReliabilityCoverageMetrics
        analysis={analysis}
        locale={locale}
        timeZone={timeZone}
      />
      <ArrivalReliabilitySupportMetrics
        analysis={analysis}
        locale={locale}
      />
    </div>
  );
}
