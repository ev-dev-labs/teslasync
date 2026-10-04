import type { UnitPref } from '@/lib/unitConversion';

export type MetricFormat = 'count' | 'currency' | 'energy' | 'power' | 'duration'
  | 'distance' | 'speed' | 'percent' | 'ratio' | 'efficiency' | 'temperature'
  | 'pressure' | 'score' | 'number' | 'text' | 'status';
export type MetricRaw = number | string | null | undefined;
export interface MetricDefinition {
  readonly label: string;
  readonly description: string;
  readonly format: MetricFormat;
  readonly inputUnit: string;
  readonly goodDirection: 'up' | 'down' | 'none';
}
export interface MetricPreferences {
  readonly units: UnitPref;
  /** Existing symbol semantics are preserved. Never guess an ISO code from "$". */
  readonly currency: { readonly kind: 'symbol' | 'iso'; readonly value: string };
}
export interface FormattedMetric {
  readonly value: string;
  readonly unit: string;
  readonly text: string;
  readonly state: 'value' | 'missing' | 'invalid';
  readonly reason?: string;
  readonly reasonKey?: string;
  readonly accessibility: string;
  /** Original measurement retained independently of display rounding. */
  readonly rawValue: MetricRaw;
}
export type StatPeriod =
  | { readonly kind: 'unknown'; readonly label: string; readonly reason?: string }
  | { readonly kind: 'analysis'; readonly label: string; readonly start: string;
      readonly endExclusive: string; readonly timezone: string;
      readonly completeness: 'complete' | 'subset' | 'unknown'; readonly provenance: string }
  | { readonly kind: 'alltime'; readonly label: string; readonly provenance: string }
  | { readonly kind: 'event'; readonly label: string; readonly eventId: string;
      readonly start: string; readonly end: string | null; readonly provenance: string }
  | { readonly kind: 'snapshot'; readonly label: string; readonly observedAt: string | null;
      readonly provenance: string };
