// Native parity port of web/src/hooks/useChartPalette.ts.
//
// The web hook is pure TypeScript: it reads the persisted `chart_palette`
// Settings value via the canonical TanStack Query settings hook and resolves it
// to a `readonly string[]` chart-series palette. There are zero DOM, Recharts,
// or web-UI dependencies, so the resolution logic ports 1:1 to React Native.
//
// The only adaptation is the palette *source*. The web original imports
// `CHART_COLORS_CB_SAFE` / `CHART_COLORS_NEON` from `@/lib/colors`; the native
// parity tree keeps those identical palettes (the color-blind-safe Okabe-Ito
// default and the stylistic neon opt-in, same hex values) in
// `../components/charts/chartUtils`, exported as `CHART_COLORS` and
// `NEON_COLORS`. Reusing them here keeps this hook in lock-step with the exact
// colors the native charts actually render, instead of duplicating the arrays.
//
// `useSettings` is the native parity TanStack Query hook
// (`../api/hooks/useSettings`); its `AppSettings.chart_palette` field carries
// the `'cb_safe' | 'neon'` preference. Unlike the web build there is no
// cross-tab BroadcastChannel on native (see
// `nativeSettingsHookCapabilities.queryBroadcastAvailable === false`), but a
// settings mutation still invalidates the shared query cache so every in-app
// consumer of this hook re-renders with the new palette.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported.

import { useSettings } from '../api/hooks/useSettings';
import { CHART_COLORS, NEON_COLORS } from '../components/charts/chartUtils';

/** Persisted Settings value for the user's preferred chart palette. */
export type ChartPaletteId = 'cb_safe' | 'neon';

/** All built-in palettes, keyed by Settings value. */
export const CHART_PALETTES: Record<ChartPaletteId, readonly string[]> = {
  cb_safe: CHART_COLORS,
  neon: NEON_COLORS,
};

/**
 * Resolve a `chart_palette` Settings value (which may be `undefined` or any
 * string) to the corresponding palette array. Falls back to the CB-safe
 * default for unknown / missing values so consumers never need to null-check.
 */
export function resolveChartPalette(
  pref: string | null | undefined,
): readonly string[] {
  return pref === 'neon' ? CHART_PALETTES.neon : CHART_PALETTES.cb_safe;
}

/**
 * Returns the user-preferred chart series palette as `readonly string[]`.
 *
 * Reads `chart_palette` from the server-persisted `AppSettings` via the
 * canonical native TanStack Query hook (`../api/hooks/useSettings`), so a
 * settings mutation invalidates the shared cache and re-renders every consumer
 * with the new palette.
 *
 * Defaults to the color-blind-safe Okabe-Ito palette (`CHART_COLORS`) when the
 * preference is missing, unloaded, or unrecognised — matching the static
 * `CHART_COLORS` default exposed by the native charts module
 * (`../components/charts/chartUtils`). Pair this with the theme-derived
 * `useThemeChartPalette()` (in `../components/charts`) when you need the
 * gradient palette object with semantic positive/negative/warning/neutral
 * colours instead of the flat series array.
 */
export function useChartPalette(): readonly string[] {
  const { data } = useSettings();
  return resolveChartPalette(data?.chart_palette);
}
