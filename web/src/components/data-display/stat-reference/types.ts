import type { ReactNode } from 'react';
import type { MetricId, MetricPreferences, MetricRaw, MetricDisplayOptions, StatPeriod } from '@/lib/metric-reference';

export interface StatMetric {
  readonly metricId: MetricId;
  readonly rawValue: MetricRaw;
  /** Stable occurrence key when a semantic metric repeats. Never a semantic metric ID. */
  readonly occurrenceId?: string;
  readonly missingReason?: string;
  readonly href?: string;
  /** Existing domain translations; generic quantity labels never replace source semantics. */
  readonly label?: string;
  readonly description?: string;
  readonly context?: ReactNode;
  readonly display?: MetricDisplayOptions;
  /** Preserve an existing specialist Delta's operands, zero-baseline behavior and direction. */
  readonly comparisonContent?: ReactNode;
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
  readonly comparisonLabel?: string;
  readonly secondary?: ReactNode;
  readonly footer?: ReactNode;
  readonly emptyContent?: ReactNode;
  readonly testId?: string;
  /** Only for StatGroup: period is provided visibly by its card header. */
  readonly periodInHeader?: boolean;
  readonly periodHeaderId?: string;
  /** Additional explicit acknowledgement: the owning header also shows the reason/provenance. */
  readonly periodContextInHeader?: boolean;
}
export type StatGroupProps = Omit<StatStripProps, 'variant'>;
