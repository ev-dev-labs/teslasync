/**
 * Native parity port of web/src/lib/preferredRange.ts.
 *
 * Pure, non-visual selection utility. There is no DOM, JSX, Recharts, Leaflet,
 * browser HTML elements, or old web UI imports here — the module is a couple of
 * type/interface declarations, one string constant, and a single pure function
 * that picks `rated_range` vs `ideal_range` from a state snapshot. The only
 * platform constructs used — strict equality, the nullish-coalescing operator,
 * and optional chaining — are all available on Hermes and in the Jest/Node gate
 * environment, so the logic ports byte-for-byte and behaves identically under
 * React Native with no native-safe shim required.
 *
 * SI metres semantics (both `rated_range` and `ideal_range` are SI metres),
 * the `'rated'` fallback that matches the backend `useSettings` default, and the
 * English `labelKey`/`defaultLabel` i18n-fallback intent are preserved verbatim
 * from web so callers select the preferred range at the display edge exactly as
 * on web. Per the SI-canonical contract this helper reads SI directly and never
 * converts units — display conversion stays at the React render boundary.
 */

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
 * Pick the preferred range value + label from a vehicle/charge state
 * snapshot. Defaults to `'rated'` when the preference is missing or
 * mistyped, matching the backend default in `useSettings`.
 */
export function selectPreferredRange(
  state: PreferredRangeFields | null | undefined,
  rangeType: string | null | undefined,
): PreferredRangeResult {
  const type: RangeType = rangeType === 'ideal' ? 'ideal' : FALLBACK_TYPE
  const meters = type === 'ideal' ? state?.ideal_range ?? null : state?.rated_range ?? null
  return type === 'ideal'
    ? { meters, source: 'ideal', labelKey: 'idealRange', defaultLabel: 'Ideal Range' }
    : { meters, source: 'rated', labelKey: 'ratedRange', defaultLabel: 'Rated Range' }
}
