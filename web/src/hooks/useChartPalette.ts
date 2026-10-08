import { useMemo } from 'react'
import { useTheme, type ColorTheme, type ModeTheme } from '@/components/ui/ThemeProvider'
import { useSettings } from '@/api/hooks/useSettings'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON, buildChartPalette } from '@/lib/colors'

/** Persisted Settings value for the user's preferred chart palette. */
export type ChartPaletteId = 'cb_safe' | 'neon'

/** All built-in palettes, keyed by Settings value. */
export const CHART_PALETTES: Record<ChartPaletteId, readonly string[]> = {
  cb_safe: CHART_COLORS_CB_SAFE,
  neon: CHART_COLORS_NEON,
}

/**
 * Resolve a `chart_palette` Settings value (which may be `undefined` or any
 * string) to the corresponding palette array. Falls back to the CB-safe
 * default for unknown / missing values so consumers never need to null-check.
 */
export function resolveChartPalette(
  pref: string | null | undefined,
  context?: { theme: ColorTheme; mode: ModeTheme },
): readonly string[] {
  const palette = pref === 'neon' ? CHART_PALETTES.neon : CHART_PALETTES.cb_safe
  return context?.mode.colorScheme === 'light'
    ? buildChartPalette(context.theme, context.mode, palette).series
    : palette
}

/**
 * Returns the user-preferred chart series palette as `readonly string[]`.
 *
 * Reads `chart_palette` from the server-persisted `AppSettings` via the
 * canonical TanStack Query hook (`@/api/hooks/useSettings`), so cross-tab
 * settings broadcasts mutate every consumer instantly.
 *
 * Defaults to the restrained Okabe-Ito hue order
 * (`CHART_COLORS_CB_SAFE`) when the preference is missing, unloaded, or
 * unrecognised — matching the static `CHART_COLORS` default in
 * `@/lib/colors`. Pass through to `useThemeChartPalette()` (in
 * `@/lib/colors`) when you need the theme-derived gradient palette object
 * with semantic positive/negative/warning/neutral colours.
 *
 */
export function useChartPalette(): readonly string[] {
  const { data } = useSettings()
  const { theme, mode } = useTheme()
  return useMemo(() => resolveChartPalette(data?.chart_palette, { theme, mode }), [data?.chart_palette, theme, mode])
}
