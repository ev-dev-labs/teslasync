import type { ReactNode } from 'react';
import { StatStrip } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';

export interface BatterySummaryMetric {
  key: string;
  label: string;
  value: string;
  icon?: ReactNode;
}

export interface BatterySpecialistSummaryProps {
  metrics: readonly BatterySummaryMetric[];
  title: string;
  period: StatPeriod;
  loading?: boolean;
  retained?: boolean;
  testId: string;
}

/** These are specialist display overrides, not new numeric calculations.
 * Cost denominators, lower bounds, mixed business periods, missing measurements,
 * battery age and BMS status cannot be reinterpreted by a generic formatter.
 * Typed text preserves the authoritative page formatter and occurrence identity. */
export function BatterySpecialistSummary({
  metrics, title, period, loading, retained, testId,
}: BatterySpecialistSummaryProps) {
  return (
    <section aria-label={title} className="min-w-0 w-full">
    <StatStrip
      title={title}
      period={period}
      loading={loading}
      retained={retained}
      testId={testId}
      metrics={metrics.map(metric => ({
        metricId: 'text',
        occurrenceId: metric.key,
        rawValue: metric.value,
        label: metric.label,
        context: metric.icon && <span aria-hidden="true">{metric.icon}</span>,
      }))}
    />
    </section>
  );
}
