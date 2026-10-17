import type { ReactNode } from 'react';
import type { MetricId, MetricRaw } from '@/lib/metric-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import type { StatPeriod } from '@/lib/metric-reference';

export interface BatterySummaryMetric {
  key: string;
  label: string;
  value: string;
  rawValue: MetricRaw;
  metricId: MetricId;
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

/** Preserve proven source displays while validating the raw numerical input. */
export function BatterySpecialistSummary({
  metrics, title, period, loading, retained, testId,
}: BatterySpecialistSummaryProps) {
  return (
    <section className="min-w-0 w-full">
    <BatteryEvidenceBrief
      title={title}
      period={period}
      loading={loading}
      retained={retained}
      id={testId}
      metrics={metrics.map(metric => ({
        metricId: metric.metricId,
        occurrenceId: metric.key,
        rawValue: metric.rawValue,
        label: metric.label,
        display: metric.metricId === 'status' || metric.metricId === 'text'
          ? undefined : { formatter: () => ({ value: metric.value, unit: '' }) },
        context: metric.icon && <span aria-hidden="true">{metric.icon}</span>,
      }))}
    />
    </section>
  );
}
