import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';
import type { MetricId } from '@/lib/metric-reference';

export function numericPresentedMetric(
  occurrenceId: string,
  metricId: MetricId,
  label: string,
  rawValue: number | null | undefined,
  formatter: (raw: number) => string,
  available = true,
  context?: ReactNode,
): StatMetric {
  return {
    occurrenceId, metricId, label, description: label, context,
    rawValue: available ? rawValue : null,
    display: { formatter: raw => ({ value: formatter(raw), unit: '' }) },
  };
}

/** Source text only (for example a formatted date); measurements use numericPresentedMetric. */
export function presentedMetric(
  occurrenceId: string,
  label: string,
  value: string,
  context?: ReactNode,
  comparisonContent?: ReactNode,
): StatMetric {
  return {
    occurrenceId,
    metricId: 'text',
    rawValue: value || '—',
    label,
    description: label,
    context,
    comparisonContent,
  };
}

/** Describe the existing local Monday–Sunday window, including DST changes.
 * This is display metadata only: no request bounds or hook policy is changed.
 * Completeness is not asserted because the inherited requests are bounded.
 */
export function weeklyPeriod(
  start: Date,
  label: string,
  timezone: string,
  provenance: string,
): StatPeriod {
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + 7);
  return {
    kind: 'analysis',
    label: label || '—',
    start: start.toISOString(),
    endExclusive: endExclusive.toISOString(),
    timezone,
    completeness: 'unknown',
    provenance,
  };
}
