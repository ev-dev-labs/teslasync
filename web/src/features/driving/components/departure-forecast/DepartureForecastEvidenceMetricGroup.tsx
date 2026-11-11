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
      <dl data-app-part="list metric-grid" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            data-app-part="metric"
            data-app-metric="tile"
            data-surface-variant="embedded"
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <Text data-app-part="metric-label" as="dt" variant="caption">
              {metric.label}
            </Text>
            <Text data-app-part="metric-reading" as="dd" variant="bodySm" className="mt-1 font-medium">
              <span data-app-part="metric-value">{metric.value}</span>
            </Text>
          </div>
        ))}
      </dl>
    </div>
  );
}
