/**
 * Pure helper for the `preferred_range` General-Settings preference.
 *
 * Tesla exposes two range estimates per vehicle state — `rated_range` and
 * `ideal_range` (both in SI metres) — and the user's preference picks
 * which one is treated as "the" range across primary range surfaces
 * (Glance, vehicle list cards, charge status, dashboard hero, …).
 *
 * Explicit comparison surfaces (the dual-bar `RangeBarWidget`, the
 * side-by-side `BatteryRangePanel`) intentionally render BOTH ranges and
 * should NOT route through this helper.
 *
 * The helper is intentionally pure (no React, no settings hook) so it
 * can be reused from non-React contexts (downloadable certificates,
 * server-side helpers, file-export builders).
 */
export type RangeType = 'rated' | 'ideal'

export interface PreferredRangeFields {
  rated_range?: number | null
  ideal_range?: number | null
}

export interface PreferredRangeResult {
  /** Selected range value in SI metres, or `null` when missing. */
  meters: number | null
  /** Which field was selected. */
  source: RangeType
  /** Human-readable English label key suffix (e.g. for `t('common.idealRange')`). */
  labelKey: 'idealRange' | 'ratedRange'
  /** Default English label, suitable as a `t()` fallback. */
  defaultLabel: 'Ideal Range' | 'Rated Range'
}

const FALLBACK_TYPE: RangeType = 'rated'

/**
 * Normalise a raw range field to a finite SI-metre value or `null`.
 *
 * Guards the display boundary against `NaN`/`±Infinity` leaking through as
 * `"NaN km"` / `"∞ km"`: non-finite (and missing) inputs collapse to `null`
 * so consumers render their empty state instead of a broken number. A
 * legitimate `0` is preserved (an empty battery still has a valid `0 m`).
 */
function finiteMeters(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Pick the preferred range value + label from a vehicle/charge state
 * snapshot. Defaults to `'rated'` when the preference is missing or
 * mistyped, matching the backend default in `useSettings`.
 */
export function selectPreferredRange(
  state: PreferredRangeFields | null | undefined,
  rangeType: string | null | undefined,
): PreferredRangeResult {
  const type: RangeType = rangeType === 'ideal' ? 'ideal' : FALLBACK_TYPE
  const meters = finiteMeters(type === 'ideal' ? state?.ideal_range : state?.rated_range)
  return type === 'ideal'
    ? { meters, source: 'ideal', labelKey: 'idealRange', defaultLabel: 'Ideal Range' }
    : { meters, source: 'rated', labelKey: 'ratedRange', defaultLabel: 'Rated Range' }
}
