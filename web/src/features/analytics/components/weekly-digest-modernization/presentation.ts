import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { StatPeriod } from '@/lib/metric-reference';

/**
 * Lossless bridge for the digest's existing specialist display contracts.
 * In particular efficiency is Wh/display-distance, not the reference
 * formatter's preference-energy/display-distance. Currency and SI formatters
 * also have different default precision. Keep those existing formatters;
 * StatTile still owns formatMetric, accessibility and responsive rendering.
 * This adapter performs no formatting, conversion or numeric coercion.
 */
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
