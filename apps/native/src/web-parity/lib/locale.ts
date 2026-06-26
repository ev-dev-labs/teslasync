// Native parity port of web/src/lib/locale.ts.
//
// Pure, DOM-free BCP-47 locale-resolution helper. There is no browser, React,
// HTML, Recharts, Leaflet or web-UI dependency to strip — `resolveLocale` only
// inspects/trims a string, so it runs unchanged under React Native (the
// contract's "non-visual utility code -> port the logic/types faithfully" path,
// matching the existing lib parity ports gear.ts / chartA11y.ts /
// confirmSilence.ts which preserve their logic byte-for-byte). The function
// body is reproduced statement-for-statement; only native formatting
// (statement-terminating semicolons per the apps/native prettier config) was
// added. The `Intl.*` references in the JSDoc describe the *callers'* behaviour
// and are documentation only — this helper never touches Intl itself, so it is
// safe on every Hermes/JSC runtime regardless of ICU availability.

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
  if (typeof locale === 'string' && locale.trim().length > 0) return locale;
  return 'en-US';
}
