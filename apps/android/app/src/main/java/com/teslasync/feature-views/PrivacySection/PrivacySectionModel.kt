// Pure, framework-free model + projection for the Privacy feature view — the native analogue of
// everything the web component computes before returning JSX
// (web/src/features/settings/components/PrivacySection.tsx + its two backing client stores
// web/src/lib/recentPages.ts and web/src/lib/cookieConsent.ts). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web section surfaces two client-side privacy switches — a "clear recently viewed pages" control
// (reads the LRU count, wipes it) and a tri-state cookie/GDPR consent control (read / accept / decline /
// reset) — plus a server-declared `require_cookie_consent` flag (from `/system/version`) that only toggles
// which descriptive sentence the consent block shows. This file owns the tri-state consent taxonomy + its
// web wire strings, the render-ready [PrivacySnapshot], the defensive decoders for both client stores
// (verbatim ports of the web `getConsent()` and recent-pages `load()` validation), and the small enabled-
// state predicates the three consent buttons + the clear button derive from the current values.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PrivacySection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.privacy

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

private const val KEY_PATH = "path"
private const val KEY_TITLE = "title"
private const val KEY_KIND = "kind"
private const val KEY_VISITED_AT = "visited_at"

/**
 * The user's stored cookie/analytics consent decision — the native mirror of the web `ConsentState`
 * union (`web/src/lib/cookieConsent.ts`). [Unknown] means no decision has been recorded yet (the banner
 * would still appear); [Accepted] and [Declined] are explicit user choices. [wire] is the exact literal
 * the web store persists for the explicit states ([Unknown] is materialized by the *absence* of the
 * stored key, never a sentinel), so a value written by any client decodes identically.
 */
enum class ConsentState(
    val wire: String?,
) {
    Unknown(null),
    Accepted("accepted"),
    Declined("declined"),
    ;

    companion object {
        /**
         * Resolve a persisted raw value to its state exactly as the web `getConsent()` does: the literal
         * `"accepted"`/`"declined"` map to their states, and anything else — a null/blank/corrupt value or
         * an unrecognized string — collapses to [Unknown] (never throws).
         */
        fun fromWire(raw: String?): ConsentState = entries.firstOrNull { it.wire != null && it.wire == raw } ?: Unknown
    }
}

/**
 * The render-ready Privacy surface model — the native analogue of the three values the web component
 * folds into its JSX (`count`, `consent`, `requireConsent`). Pure data (no Compose types): the recent-page
 * [recentCount] (web `getRecentPages().length`), the current [consent] tri-state, and [requireConsent],
 * the deployment-wide GDPR/ePrivacy flag (web `Boolean(versionQuery.data?.require_cookie_consent)`) that
 * only selects which descriptive sentence the consent block renders.
 */
data class PrivacySnapshot(
    val recentCount: Int,
    val consent: ConsentState,
    val requireConsent: Boolean,
)

/**
 * Canonical metadata for this surface. The web source is a settings *component* (not a registry grid
 * widget), so there is no registry id/footprint to mirror — only the diagnostics [SLUG] (P1/S11), the
 * display cap on entries counted (web `RECENT_PAGES_MAX`), and the client-side persistence coordinates the
 * two read/write stores bind to. The recent-pages prefs file + key deliberately match the sibling
 * Recently-Viewed surface so a clear here wipes the same list that widget reads — the native counterpart
 * of the web sharing one `localStorage` key across both surfaces.
 */
object PrivacyRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "PrivacySection"

    /** Hard cap on entries counted from the recent-pages store (web `RECENT_PAGES_MAX`). */
    const val MAX_RECENT_ENTRIES = 50

    /** SharedPreferences file the recent-pages list is persisted in (client-side only, never synced). */
    const val RECENT_PAGES_PREFS = "teslasync_recent_pages"

    /** Versioned recent-pages entry key (mirrors the web `teslasync:recent-pages:v1` storage key). */
    const val RECENT_PAGES_KEY = "teslasync:recent-pages:v1"

    /** SharedPreferences file the consent decision is persisted in (client-side only, never synced). */
    const val CONSENT_PREFS = "teslasync_consent"

    /** Consent storage key (mirrors the web `teslasync:consent:v1` storage key). */
    const val CONSENT_KEY = "teslasync:consent:v1"
}

/**
 * Counts the valid entries in the persisted recent-pages JSON — a verbatim port of the validation in the
 * web `load()` (`web/src/lib/recentPages.ts`): it tolerates a null/blank/corrupt value (returning `0`
 * rather than throwing), counts only well-formed entries (a string `path`, string `title`, string `kind`,
 * and a finite numeric `visited_at`), and stops at [PrivacyRegistration.MAX_RECENT_ENTRIES]. Pure +
 * JVM-testable so the "cached → count" adapter path is covered off-device.
 */
object RecentPagesCounter {
    private val json = Json { ignoreUnknownKeys = true }

    /** Number of valid recent-page entries in [raw], or `0` for any malformed input. */
    fun count(raw: String?): Int {
        if (raw.isNullOrBlank()) return 0
        return runCatching { countArray(raw) }.getOrDefault(0)
    }

    private fun countArray(raw: String): Int {
        val array = json.parseToJsonElement(raw) as? JsonArray ?: return 0
        return array
            .asSequence()
            .filterIsInstance<JsonObject>()
            .filter(::isValidEntry)
            .take(PrivacyRegistration.MAX_RECENT_ENTRIES)
            .count()
    }

    private fun isValidEntry(obj: JsonObject): Boolean =
        obj.stringField(KEY_PATH) != null &&
            obj.stringField(KEY_TITLE) != null &&
            obj.stringField(KEY_KIND) != null &&
            obj.finiteField(KEY_VISITED_AT) != null

    private fun JsonObject.stringField(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.finiteField(name: String): Double? {
        val value = (this[name] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
        return value?.takeIf { it.isFinite() }
    }
}

/**
 * The small, pure render predicates the four controls derive from the current [PrivacySnapshot] — the
 * native port of the web `disabled={...}` expressions. Extracted here so each branch is unit-tested
 * without a UI host and the composable stays a thin render layer.
 */
object PrivacyProjection {
    /** The clear-recent-pages control is enabled only when there is something to wipe (web `count === 0`). */
    fun clearEnabled(recentCount: Int): Boolean = recentCount > 0

    /** "Re-grant consent" is enabled unless consent is already accepted (web `consent === 'accepted'`). */
    fun acceptEnabled(consent: ConsentState): Boolean = consent != ConsentState.Accepted

    /** "Withdraw consent" is enabled unless consent is already declined (web `consent === 'declined'`). */
    fun declineEnabled(consent: ConsentState): Boolean = consent != ConsentState.Declined

    /** "Reset" is enabled unless consent is already unknown (web `consent === 'unknown'`). */
    fun resetEnabled(consent: ConsentState): Boolean = consent != ConsentState.Unknown
}
