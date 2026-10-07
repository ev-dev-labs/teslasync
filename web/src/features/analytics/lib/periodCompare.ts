import { resolveSemantic, type Direction, type MetricId } from '@/lib/metricSemantics';
import { fmtNumber } from '@/lib/numberFormat';

/** Metrics compared by the Period Compare page. */
export type CompareMetricKey =
  | 'distance'
  | 'drives'
  | 'energy'
  | 'efficiency'
  | 'cost'
  | 'co2';

export type CompareMetricSemantic = MetricId | { direction: Direction };

/**
 * Direction semantics per compared metric. Only metrics whose good direction
 * is unambiguous carry a judgment: distance/drives are neutral context (more
 * driving is not inherently better), energy/efficiency/cost improve downward,
 * and avoided CO2 improves upward.
 */
export const COMPARE_METRIC_SEMANTICS: Record<
  CompareMetricKey,
  CompareMetricSemantic
> = {
  distance: 'distance',
  drives: 'trip_count',
  energy: 'energy_consumed',
  efficiency: 'efficiency',
  cost: 'cost',
  co2: { direction: 'higher_better' },
};

export interface PctChange {
  value: string;
  /** Raw direction of movement (true when a >= b). Prefer assessDelta. */
  positive: boolean;
  /** True when there is no baseline to compare against (b === 0). */
  neutral: boolean;
}

export function pctChange(a: number, b: number): PctChange {
  if (b === 0) return { value: '—', positive: true, neutral: true };
  const pct = ((a - b) / b) * 100;
  return {
    value: `${pct > 0 ? '+' : ''}${fmtNumber(pct, 1)}%`,
    positive: pct >= 0,
    neutral: false,
  };
}

/**
 * Whether a period-over-period delta is favorable under the metric's
 * direction semantics. Null means "no judgment": neutral metric, zero
 * baseline, or zero movement. Callers render null as muted/neutral.
 */
export function assessDelta(
  semantic: MetricId | { direction: Direction },
  a: number,
  b: number,
): { favorable: boolean | null } {
  const direction = resolveSemantic(semantic).direction;
  if (b === 0 || a === b || direction === 'neutral') return { favorable: null };
  const up = a > b;
  return { favorable: direction === 'higher_better' ? up : !up };
}

/** Bar fills for the delta chart (repo semantic hexes, cf. SEVERITY_HEX). */
export const DELTA_FILL = {
  favorable: '#10b981',
  unfavorable: '#ef4444',
  neutral: '#64748b',
} as const;
