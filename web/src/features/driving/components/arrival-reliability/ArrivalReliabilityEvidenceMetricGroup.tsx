import { Heading, MetricLabel, MetricValue } from '@/components/ui';

export interface ArrivalReliabilityEvidenceMetric {
  label: string;
  value: string;
}

interface ArrivalReliabilityEvidenceMetricGroupProps {
  title: string;
  metrics: ArrivalReliabilityEvidenceMetric[];
}

export function ArrivalReliabilityEvidenceMetricGroup({
  title,
  metrics,
}: ArrivalReliabilityEvidenceMetricGroupProps) {
  return (
    <section>
      <Heading level="sub" className="mb-3">
        {title}
      </Heading>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <MetricLabel>{metric.label}</MetricLabel>
            <MetricValue className="mt-1">{metric.value}</MetricValue>
          </div>
        ))}
      </div>
    </section>
  );
}
