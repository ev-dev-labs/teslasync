/**
 * Pure parsing + aggregation helpers for the Tesla account feature-config
 * blob returned by `GET /api/v1/tesla/user/feature-config`.
 *
 * Tesla returns a flat map of `feature name -> value` where each value is
 * either a plain boolean (a simple flag) or an object that carries an
 * `enabled` field plus feature-specific configuration ("configured"
 * feature). These helpers normalise that shape into typed rows and the
 * summary metrics the redesigned page renders, keeping the React
 * components free of parsing logic and independently unit-testable.
 */

/** A simple boolean flag vs. an object-valued, configured feature. */
export type FeatureFlagKind = 'flag' | 'configured';

/** One normalised feature-config row. */
export interface FeatureFlagEntry {
  /** Raw feature key from Tesla (kept verbatim — not user-facing copy). */
  key: string;
  /** Resolved on/off state. */
  enabled: boolean;
  /** Human-readable summary of the non-`enabled` sub-fields, or `null`. */
  details: string | null;
  /** Whether the value was a bare boolean or a configured object. */
  kind: FeatureFlagKind;
}

/** Aggregate counts derived from the parsed entries. */
export interface FeatureFlagSummary {
  total: number;
  enabled: number;
  disabled: number;
  /** Percentage (0–100) of features that are enabled; 0 when `total` is 0. */
  enabledRate: number;
}

/** One grouped bar for the enabled-vs-disabled composition chart. */
export interface FeatureCompositionRow {
  kind: FeatureFlagKind;
  enabled: number;
  disabled: number;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  // Arrays are `typeof 'object'` too, but a Tesla feature-config value is
  // either a bare boolean flag or a keyed "configured" object — never a
  // positional array. Excluding arrays keeps the documented "plain object"
  // contract: a top-level array yields an empty list instead of junk
  // index-keyed rows, and an array-valued feature falls through to the
  // boolean-flag branch instead of being mis-read as a configured object.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalise the raw feature-config data object into sorted, typed rows.
 * Accepts `unknown` so callers can hand over the untyped API payload
 * directly; anything that isn't a plain object yields an empty list.
 */
export function parseFeatureEntries(data: unknown): FeatureFlagEntry[] {
  if (!isRecord(data)) return [];

  const entries = Object.entries(data).map(([key, value]): FeatureFlagEntry => {
    const configured = isRecord(value);
    const enabled = configured ? Boolean(value.enabled) : Boolean(value);
    const details = configured
      ? Object.entries(value)
          .filter(([k]) => k !== 'enabled')
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(', ')
      : '';
    return {
      key,
      enabled,
      details: details.length > 0 ? details : null,
      kind: configured ? 'configured' : 'flag',
    };
  });

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/** Compute enabled/disabled totals and the enabled rate from parsed rows. */
export function summarizeFeatureEntries(entries: FeatureFlagEntry[]): FeatureFlagSummary {
  const rows = entries ?? [];
  const total = rows.length;
  const enabled = rows.reduce((n, e) => (e.enabled ? n + 1 : n), 0);
  const disabled = total - enabled;
  const enabledRate = total > 0 ? (enabled / total) * 100 : 0;
  return { total, enabled, disabled, enabledRate };
}

/**
 * Build the enabled-vs-disabled breakdown grouped by feature kind. Only
 * kinds that actually occur are returned so the chart never renders an
 * all-zero column.
 */
export function buildFeatureComposition(entries: FeatureFlagEntry[]): FeatureCompositionRow[] {
  const all = entries ?? [];
  const order: FeatureFlagKind[] = ['flag', 'configured'];
  return order
    .map((kind): FeatureCompositionRow => {
      const rows = all.filter((e) => e.kind === kind);
      const enabled = rows.reduce((n, e) => (e.enabled ? n + 1 : n), 0);
      return { kind, enabled, disabled: rows.length - enabled, total: rows.length };
    })
    .filter((row) => row.total > 0);
}
