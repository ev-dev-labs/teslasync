import type { MetricId, MetricPreferences, MetricRaw, StatPeriod } from '@/lib/metric-reference';

export interface StatMetric {
  readonly metricId: MetricId;
  readonly rawValue: MetricRaw;
  /** Stable occurrence key when a semantic metric repeats. Never a semantic metric ID. */
  readonly occurrenceId?: string;
  readonly missingReason?: string;
  readonly href?: string;
  /** Comparison has its own semantic type and source period. Absent means omitted. */
  readonly comparison?: {
    readonly metricId: MetricId;
    readonly rawValue: number;
    readonly period: StatPeriod;
    readonly label: string;
    readonly signed?: boolean;
  };
}
export interface StatStripProps {
  readonly metrics: readonly StatMetric[];
  readonly period: StatPeriod;
  readonly id?: string;
  readonly title?: string;
  readonly variant?: 'standalone' | 'embedded';
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly retained?: boolean;
  readonly breakdown?: readonly string[];
  readonly preferences?: MetricPreferences;
  readonly className?: string;
  /** Only for StatGroup: period is provided visibly by its card header. */
  readonly periodInHeader?: boolean;
  readonly periodHeaderId?: string;
}
export type StatGroupProps = Omit<StatStripProps, 'variant'>;
