// Pure, framework-free model + projection for the FormatterPrefsBridge shared surface — the native analogue of
// the data the web component derives before its side effects (web/src/components/FormatterPrefsBridge.tsx: the
// `useSettings` read folded into `resolveLocale(settings.locale)` and `settings.decimal_precision ?? 2`). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin, side-effect-only mount.
//
// The web `FormatterPrefsBridge` is a headless coordinator: it keeps the module-level formatter globals
// (`numberFormat._globalLocale` / `_globalPrecision`) in sync with the persisted `/settings` document so a page
// that imports a formatter directly still renders in the user's locale + decimal precision, and it holds a
// permanent `['settings']` subscriber so a cross-tab settings change always refetches. The native formatter
// (shared `io.teslasync.shared.core.units`) is PURE and deliberately keeps NO module-level cache — "the caller
// owns the preference lifecycle" — so there are no mutable globals to write. The faithful native analogue is to
// RESOLVE the same two values the web syncs (locale + decimal precision) together with the full display
// [UnitPref] into a single immutable [FormatterPrefs] the app can read app-wide, and to expose whether a
// settings document has resolved yet so the bridge applies prefs exactly when the web does (`if (!settings)
// return`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/FormatterPrefsBridge — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the two settings keys the bridge reads, and the web fallback defaults are pinned here so the
 * native and web surfaces stay in lockstep.
 */
object FormatterPrefsBridgeRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FormatterPrefsBridge"

    /** Settings-document key holding the user's BCP-47 locale (web `settings.locale`). */
    const val LOCALE_KEY: String = "locale"

    /** Settings-document key holding the user's decimal precision (web `settings.decimal_precision`). */
    const val DECIMAL_PRECISION_KEY: String = "decimal_precision"

    /** The locale used when the document carries none (web `resolveLocale` fallback / native default). */
    const val DEFAULT_LOCALE: String = "en-US"

    /** Decimal precision used when the document carries none — the web `decimal_precision ?? 2`. */
    const val DEFAULT_DECIMAL_PRECISION: Int = 2
}

/**
 * The resolved formatter globals the bridge keeps in sync — the native mirror of the web's two synced module
 * globals (`_globalLocale` + `_globalPrecision`) together with the full display [unitPref] the shared `formatX`
 * functions consume. A consumer that needs to format outside a settings-bound surface reads this single value
 * instead of re-deriving the preference, exactly as the web globals are read app-wide.
 *
 * @property locale resolved BCP-47 locale (web `resolveLocale(settings.locale)`); never blank.
 * @property decimalPrecision resolved decimal precision (web `settings.decimal_precision ?? 2`); always `>= 0`.
 * @property unitPref the full display preference bag (per-quantity units + locale + precision) the shared SI
 *   `formatX` functions consume; the native counterpart of the per-page `useUnits()` result.
 */
data class FormatterPrefs(
    val locale: String,
    val decimalPrecision: Int,
    val unitPref: UnitPref,
)

/**
 * The immutable, observe-ready state the bridge publishes — the resolved formatter globals plus the honest
 * ADR-013 freshness envelope of the settings document they came from. There is no visible UI (the web returns
 * `null`); these fields let a consumer of [prefs] tell live prefs from cached/last-known ones without the bridge
 * ever blanking the value.
 *
 * @property resolved whether a `/settings` document has been observed — the web `if (!settings) return` gate.
 *   Until the first document resolves, [prefs] holds the metric defaults the web globals start at.
 * @property prefs the resolved formatter globals (defaults until [resolved]).
 * @property stale cached prefs are past their TTL and a refresh is in flight (no failure yet).
 * @property offline cached prefs are shown because a refresh failed (network unreachable / "last known").
 * @property refreshing a network refresh is currently running over existing prefs.
 * @property freshnessStamp the `fetchedAt` of the resolved document, or `null` before the first resolve.
 */
data class FormatterPrefsState(
    val resolved: Boolean,
    val prefs: FormatterPrefs,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val freshnessStamp: Long? = null,
)

/**
 * Pure projection + resolution logic for the FormatterPrefsBridge surface — the native port of the web bridge's
 * `resolveLocale(settings.locale)` + `settings.decimal_precision ?? 2` derivation.
 */
object FormatterPrefsProjection {
    /**
     * Resolves the formatter globals from a raw `/settings` document — the native port of
     * `resolveLocale(settings.locale)` + `settings.decimal_precision ?? 2`. The locale, per-quantity units, and
     * precision derivation is delegated to the shared [UnitPreferences.fromSettings] (the `useUnits` /
     * `useFormatting` port), then the locale (en-US when blank/absent) and the decimal precision (the web
     * default 2 when absent) are folded out of the resulting [UnitPref]. A null/partial document yields the
     * metric defaults the web globals start at.
     *
     * Parity-with-honesty: the shared [UnitPreferences] additionally guards a non-finite or negative
     * `decimal_precision` to "absent" (→ the default 2); the web `?? 2` only guards null/undefined. This is a
     * deliberate native hardening shared by every settings-derived surface, never a silent drift.
     */
    fun resolve(settings: JsonElement?): FormatterPrefs {
        val unitPref = UnitPreferences.fromSettings(settings)
        val locale = unitPref.locale?.takeIf { it.isNotBlank() } ?: FormatterPrefsBridgeRegistration.DEFAULT_LOCALE
        val decimalPrecision = unitPref.precision ?: FormatterPrefsBridgeRegistration.DEFAULT_DECIMAL_PRECISION
        return FormatterPrefs(locale = locale, decimalPrecision = decimalPrecision, unitPref = unitPref)
    }

    /**
     * Folds the settings [UiState] into the observe-ready [FormatterPrefsState]. The bridge applies prefs
     * whenever a settings document is available (fresh OR cached) — the web `if (!settings) return` gate maps to
     * [UiState.hasData] — and surfaces the honest freshness metadata (stale/offline/refreshing) for consumers,
     * never blanking the prefs: an unresolved document keeps the metric defaults the web globals start at.
     */
    fun project(settings: UiState<JsonElement>): FormatterPrefsState =
        FormatterPrefsState(
            resolved = settings.hasData,
            prefs = resolve(settings.data),
            stale = settings.stale && settings.errorKind == null,
            offline = settings.stale && settings.hasData && settings.errorKind != null,
            refreshing = settings.refreshing,
            freshnessStamp = settings.fetchedAt,
        )
}
