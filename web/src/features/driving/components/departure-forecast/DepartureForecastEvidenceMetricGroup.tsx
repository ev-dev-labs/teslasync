import { Heading, Text } from '@/components/ui';

export interface DepartureForecastEvidenceMetric {
  label: string;
  value: string;
}

interface DepartureForecastEvidenceMetricGroupProps {
  title: string;
  metrics: DepartureForecastEvidenceMetric[];
}

export function DepartureForecastEvidenceMetricGroup({
  title,
  metrics,
}: DepartureForecastEvidenceMetricGroupProps) {
  return (
    <div>
      <Heading level="sub" className="mb-2">
        {title}
      </Heading>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <Text as="dt" variant="caption">
              {metric.label}
            </Text>
            <Text as="dd" variant="bodySm" className="mt-1 font-medium">
              {metric.value}
            </Text>
          </div>
        ))}
      </dl>
    </div>
  );
}
