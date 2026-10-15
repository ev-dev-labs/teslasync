import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilityAccountingMetrics } from './ArrivalReliabilityAccountingMetrics';
import { ArrivalReliabilityCoverageMetrics } from './ArrivalReliabilityCoverageMetrics';
import { ArrivalReliabilitySupportMetrics } from './ArrivalReliabilitySupportMetrics';

interface ArrivalReliabilityEvidenceMetricsProps {
  analysis: ArrivalReliabilityResult;
  locale: string;
  timeZone: string;
  retained?: boolean;
}

export function ArrivalReliabilityEvidenceMetrics({
  analysis,
  locale,
  timeZone,
  retained = false,
}: ArrivalReliabilityEvidenceMetricsProps) {
  return (
    <div className="space-y-5">
      <ArrivalReliabilityAccountingMetrics analysis={analysis} retained={retained} />
      <ArrivalReliabilityCoverageMetrics
        analysis={analysis}
        locale={locale}
        timeZone={timeZone}
        retained={retained}
      />
      <ArrivalReliabilitySupportMetrics
        analysis={analysis}
        locale={locale}
        retained={retained}
      />
    </div>
  );
}
