/**
 * Locale resolution helper — single source of truth for BCP-47 fallback.
 *
 * The settings API can return `locale: ''` (empty string) when no locale
 * has been set yet. The `??` operator does NOT catch empty strings, so
 * `s.locale ?? 'en-US'` evaluates to `''`. Passing that to
 * `new Intl.NumberFormat('')` / `Intl.DateTimeFormat('')` throws
 * `RangeError: Invalid language tag: `.
 *
 * Use this helper at every site that hands a locale to `Intl.*` so
 * empty/whitespace inputs degrade gracefully to en-US instead of
 * crashing the rendering tree.
 */
export function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale
  return 'en-US'
}
