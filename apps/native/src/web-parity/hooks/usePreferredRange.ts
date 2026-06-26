// Native parity port of web/src/hooks/usePreferredRange.ts.
//
// The web hook is pure, UI-agnostic React: a single `useMemo` that picks the
// rangeType-aware range value + label for a vehicle/charge state snapshot,
// reading the user's `preferred_range` preference. It contains no JSX, no DOM
// element, no Recharts/Leaflet, and no browser-only API, so the logic ports 1:1
// to React Native (Hermes runs the same useMemo primitive).
//
// Two web imports are adapted the same way as the other parity hooks:
//
//   * `useSettings` from `@/hooks/useSettings` (the app-level settings hook) is
//     NOT yet ported. Following the established native convention
//     (useFaviconBadge reads `settings?.tab_badge_enabled` from the native
//     `../api/hooks/useSettings` query hook instead of the app-level hook), the
//     preference is read from `../api/hooks/useSettings`, whose `AppSettings`
//     exposes the same snake_case `preferred_range` field. The web app-level
//     hook returns `rangeType = settings.preferred_range` with a `'rated'`
//     default; here `data?.preferred_range` is `undefined` while the query is
//     loading, which `selectPreferredRange` already collapses to the same
//     `'rated'` fallback — so the observable result is identical.
//   * `selectPreferredRange` + the `RangeType` / `PreferredRangeFields` /
//     `PreferredRangeResult` types from `@/lib/preferredRange` — a pure,
//     React-free, browser-free helper that is NOT yet ported. Following the
//     useConfirm / useActiveFilterChips precedent (inline not-yet-available
//     module surface that this hook consumes), the helper and its types are
//     inlined module-locally byte-for-byte. The three types are re-exported so
//     this module's public surface matches the web `usePreferredRange.ts`
//     (which re-exports exactly those three types).
//
// The `usePreferredRange` contract, the `state` null/undefined loading
// semantics (meters === null + stable preferred-type labels), the SI-metres
// `meters` value, the i18n label-key intent (`labelKey` suffix for
// `t('common.idealRange' | 'common.ratedRange')` with English `defaultLabel`
// fallbacks), and the `[state, rangeType]` memoisation are all preserved
// exactly as on web. No DOM, Recharts, Leaflet, or web UI components are
// imported; the only runtime dependencies are react and the native
// useSettings query hook.

import {useMemo} from 'react';

import {useSettings} from '../api/hooks/useSettings';

/* ── Inlined preferredRange helper ────────────────────────────────────────────
 * Mirrors `@/lib/preferredRange` verbatim. Tesla exposes two range estimates
 * per vehicle state — `rated_range` and `ideal_range` (both in SI metres) — and
 * the user's `preferred_range` preference picks which one is treated as "the"
 * range across primary range surfaces (Glance, vehicle list cards, charge
 * status, dashboard hero, …). Explicit comparison surfaces (the dual-bar
 * RangeBarWidget, the side-by-side BatteryRangePanel) intentionally render BOTH
 * ranges and should NOT route through this helper. The helper is intentionally
 * pure (no React, no settings hook) so it can be reused from non-React
 * contexts; the native preferredRange lib is not yet ported, so it is inlined
 * here (useConfirm / useActiveFilterChips precedent). */
export type RangeType = 'rated' | 'ideal';

export interface PreferredRangeFields {
  rated_range?: number | null;
  ideal_range?: number | null;
}

export interface PreferredRangeResult {
  /** Selected range value in SI metres, or `null` when missing. */
  meters: number | null;
  /** Which field was selected. */
  source: RangeType;
  /** Human-readable English label key suffix (e.g. for `t('common.idealRange')`). */
  labelKey: 'idealRange' | 'ratedRange';
  /** Default English label, suitable as a `t()` fallback. */
  defaultLabel: 'Ideal Range' | 'Rated Range';
}

const FALLBACK_TYPE: RangeType = 'rated';

/**
 * Pick the preferred range value + label from a vehicle/charge state
 * snapshot. Defaults to `'rated'` when the preference is missing or
 * mistyped, matching the backend default in `useSettings`.
 */
function selectPreferredRange(
  state: PreferredRangeFields | null | undefined,
  rangeType: string | null | undefined,
): PreferredRangeResult {
  const type: RangeType = rangeType === 'ideal' ? 'ideal' : FALLBACK_TYPE;
  const meters =
    type === 'ideal' ? state?.ideal_range ?? null : state?.rated_range ?? null;
  return type === 'ideal'
    ? {
        meters,
        source: 'ideal',
        labelKey: 'idealRange',
        defaultLabel: 'Ideal Range',
      }
    : {
        meters,
        source: 'rated',
        labelKey: 'ratedRange',
        defaultLabel: 'Rated Range',
      };
}

/**
 * React hook returning the rangeType-aware range value + label for a
 * given vehicle/charge state snapshot. Reads the `preferred_range`
 * preference from `useSettings()`.
 *
 * Pass `null`/`undefined` for `state` when the data is still loading;
 * `meters` will be `null` and the helper returns the labels for the
 * preferred type so loading states render a stable label.
 */
export function usePreferredRange(
  state: PreferredRangeFields | null | undefined,
): PreferredRangeResult {
  const {data: settings} = useSettings();
  const rangeType = settings?.preferred_range;
  return useMemo(
    () => selectPreferredRange(state, rangeType),
    [state, rangeType],
  );
}
