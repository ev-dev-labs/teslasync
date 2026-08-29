/**
 * Pure, unit-testable helpers for the Data Quality page.
 *
 * The endpoint returns operational counters (sample counts, ratios, seconds)
 * and normalization-version provenance — there are no physical measurement
 * units here, so no `useUnits()` conversion applies. Durations are seconds and
 * are formatted at the display boundary only.
 *
 * The one rule every helper enforces: a null coverage percentage means the
 * bounded window produced NO measurement. It must never be rendered as `0 %`,
 * because "we observed nothing" and "we observed only unattested rows" are
 * different operational facts with different responses.
 */
import type {
  DataQualityFieldScore,
  DataQualitySeverity,
  NormalizationCoverageState,
  NormalizationVersionCount,
} from '@/types/admin-operator-confidence';

/**
 * Common async-state props shared by every data-bound section so each panel
 * owns its loading / empty / error rendering independently of the page.
 */
export interface SectionState {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Trust tiers for normalization coverage. `unknown` is deliberately its own
 * tier rather than the worst tier — absence of evidence is not evidence of a
 * failure.
 */
export type CoverageTrust = 'unknown' | 'none' | 'partial' | 'complete';

/**
 * Classify a coverage percentage into a trust tier.
 *
 * `state` comes from the backend and is authoritative: when it is `'unknown'`
 * (or the percentage is null / non-finite) we report `'unknown'` and never
 * guess a number.
 */
export function coverageTrust(
  pct: number | null | undefined,
  state?: NormalizationCoverageState,
): CoverageTrust {
  if (state === 'unknown') return 'unknown';
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  if (pct <= 0) return 'none';
  if (pct >= 100) return 'complete';
  return 'partial';
}

/**
 * Format a coverage percentage for display, returning `null` when there is no
 * measurement. Callers render their own localized "Unknown" label for null —
 * this helper never invents a numeric string.
 */
export function formatCoveragePct(
  pct: number | null | undefined,
  state?: NormalizationCoverageState,
  decimals = 1,
): string | null {
  if (state === 'unknown') return null;
  if (pct == null || !Number.isFinite(pct)) return null;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Human label for a normalization-version bucket. A null version is the
 * legacy/unknown provenance bucket (rows written before migration 000232) and
 * gets the caller-supplied label rather than being coerced to "0".
 */
export function versionLabel(
  version: number | null | undefined,
  legacyLabel: string,
): string {
  return version == null ? legacyLabel : `v${version}`;
}

/**
 * Sort the version distribution deterministically: the legacy/unknown bucket
 * first (it is the one an operator must act on), then ascending by version.
 * Returns a new array — the API payload is never mutated.
 */
export function sortVersions(
  versions: readonly NormalizationVersionCount[] | null | undefined,
): NormalizationVersionCount[] {
  return [...(versions ?? [])].sort((a, b) => {
    if (a.version == null && b.version == null) return 0;
    if (a.version == null) return -1;
    if (b.version == null) return 1;
    return a.version - b.version;
  });
}

/**
 * Order fields worst-first by composite score. The backend already sorts this
 * way; re-deriving it here keeps the table correct if a caller ever passes an
 * unsorted subset, and makes the ordering contract explicit + testable.
 */
export function sortFieldsWorstFirst(
  fields: readonly DataQualityFieldScore[] | null | undefined,
): DataQualityFieldScore[] {
  return [...(fields ?? [])].sort((a, b) => {
    const delta = (a.composite_score ?? 0) - (b.composite_score ?? 0);
    return delta !== 0 ? delta : a.field.localeCompare(b.field);
  });
}

/** Count fields in a given severity tier, for the KPI band. */
export function countBySeverity(
  fields: readonly DataQualityFieldScore[] | null | undefined,
  severity: DataQualitySeverity,
): number {
  return (fields ?? []).filter((f) => f.severity === severity).length;
}

/**
 * Format a duration in seconds using coarse, honest units. Sub-minute values
 * keep second precision because the freshness of a live signal feed is
 * measured there; anything longer is rounded to whole minutes/hours/days.
 */
export function formatSeconds(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** Duplicate ratio (0..1) rendered as a percentage string. */
export function formatDuplicateRatio(ratio: number | null | undefined): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return `${(ratio * 100).toFixed(1)}%`;
}
