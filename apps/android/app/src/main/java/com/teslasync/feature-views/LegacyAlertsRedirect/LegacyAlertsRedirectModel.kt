// Pure, framework-free model + resolver + diagnostics for the LegacyAlertsRedirect feature view — the native
// analogue of the synchronous redirect the web component owns
// (web/src/features/notifications/components/LegacyAlertsRedirect.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// LegacyAlertsRedirect is a query-aware redirect from the legacy `/alerts` route to the new `/notifications/*`
// routes. The web component reads the current location (its ONLY hook is `useLocation`), translates the old
// `?tab=` parameter to the matching new route, forwards every OTHER search param (filter, q, page, severity,
// vehicle_id, rule_id, …) so external deep links keep working, and returns `<Navigate to={to} replace />`. The
// fixed web mapping (web `TAB_TO_ROUTE`, default `alerts`) is:
//   • tab missing / `alerts` / unknown → `/notifications/alerts`
//   • tab=`history`                    → `/notifications/inbox`
//   • tab=`preferences`                → `/notifications/quiet-hours`
//
// State honesty: `useLocation` is synchronous and performs NO fetch, exactly as the sibling QuickNav port's only
// hook (`useTranslation`) does. There is therefore no loading / error / stale / offline lifecycle in the web
// source to reproduce — modelling those would fabricate behaviour the spec does not have (honesty covenant: no
// silent drift). What the surface genuinely varies is its resolved target: the four mapping outcomes above and
// the forwarded query. Those branches live here as the pure [LegacyAlertsRedirectResolver]; the composable
// renders only a transient route-transition affordance (never a blank box) while the host performs the redirect.
//
// Decoupling: the web `<Navigate replace />` becomes a one-shot `onRedirect(LegacyAlertsTarget)` callback the
// host wires to its NavController (popping the legacy entry for `replace` semantics). The view never touches
// navigation directly — the same hoisting the sibling QuickNav / RecentlyViewedWidget ports use.
//
// Query parity: the web uses the browser `URLSearchParams` (parse → first-wins `get` → `delete` all → re-encode
// via `toString`). [LegacyAlertsQuery] mirrors that with the JVM application/x-www-form-urlencoded codec
// (`URLDecoder` / `URLEncoder`, space ⇄ `+`), preserving pair order and tolerating malformed percent escapes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LegacyAlertsRedirect — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling QuickNav / RecentlyViewedWidget surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertsredirect

import io.teslasync.shared.core.diagnostics.Logger
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * One redirect destination — the native analogue of a web `TAB_TO_ROUTE` value. Each carries both the canonical
 * web path (web `to`, for 1:1 parity) and the Navigation-Compose [route] the host navigates to (the web path
 * with its leading slash removed, matching the canonical [io.teslasync.android.navigation.Destinations] route for
 * the same page — pinned by LegacyAlertsRedirectResolverTest so the two never drift).
 *
 * @property webPath the web destination path (e.g. `/notifications/inbox`).
 * @property route the Navigation-Compose route id (e.g. `notifications/inbox`).
 */
enum class LegacyAlertsDestination(
    val webPath: String,
    val route: String,
) {
    /** Web `/notifications/alerts` — the alerts list (also the default when no/unknown tab is supplied). */
    Alerts("/notifications/alerts", "notifications/alerts"),

    /** Web `/notifications/inbox` — the legacy `tab=history` target. */
    Inbox("/notifications/inbox", "notifications/inbox"),

    /** Web `/notifications/quiet-hours` — the legacy `tab=preferences` target. */
    QuietHours("/notifications/quiet-hours", "notifications/quiet-hours"),
}

/**
 * A resolved redirect target — the native mirror of the web `to` string the component hands `<Navigate>`. Pure
 * data (no Compose/Android types) so it is fully covered by the off-device unit gate. [forwardedQuery] holds the
 * surviving search params (the `tab` parameter stripped, every other pair preserved in order).
 *
 * @property destination the route the legacy tab maps to.
 * @property forwardedQuery the ordered params forwarded to the new route (web params after `delete('tab')`).
 */
data class LegacyAlertsTarget(
    val destination: LegacyAlertsDestination,
    val forwardedQuery: List<Pair<String, String>>,
) {
    /** The forwarded params re-encoded (web `params.toString()`); empty when nothing survives the tab strip. */
    val queryString: String get() = LegacyAlertsQuery.serialize(forwardedQuery)

    /** The destination web path (web `TAB_TO_ROUTE[tab]`). */
    val webPath: String get() = destination.webPath

    /** The destination Navigation-Compose route id. */
    val route: String get() = destination.route

    /** The exact web `to`: the path, plus `?query` only when params survive the tab strip (web `qs ? … : …`). */
    val webTo: String get() = appendQuery(destination.webPath)

    /** The native Navigation-Compose route carrying the same forwarded query — what the host navigates to. */
    val routeWithQuery: String get() = appendQuery(destination.route)

    private fun appendQuery(base: String): String {
        val encoded = queryString
        return if (encoded.isEmpty()) base else base + QUERY_PREFIX + encoded
    }

    private companion object {
        const val QUERY_PREFIX = "?"
    }
}

/**
 * Resolves the legacy `/alerts` location to a [LegacyAlertsTarget] — THE logic the web component runs before
 * returning `<Navigate>`. Reproduces the web `TAB_TO_ROUTE` lookup (default `alerts`), the first-wins `tab`
 * read, the `delete('tab')` strip, and the forwarding of every remaining param. Pure + stateless so the whole
 * mapping is verified off-device.
 */
object LegacyAlertsRedirectResolver {
    /** The legacy query parameter that selected the old tab (web `params.get('tab')`). */
    const val TAB_PARAM: String = "tab"

    /** The web default when `tab` is absent (web `?? 'alerts'`). */
    const val DEFAULT_TAB: String = "alerts"

    private val TAB_TO_DESTINATION: Map<String, LegacyAlertsDestination> =
        mapOf(
            "alerts" to LegacyAlertsDestination.Alerts,
            "history" to LegacyAlertsDestination.Inbox,
            "preferences" to LegacyAlertsDestination.QuietHours,
        )

    /**
     * Maps a legacy tab to its destination — web `TAB_TO_ROUTE[tab] ?? '/notifications/alerts'` with the web
     * `params.get('tab') ?? 'alerts'` default folded in. A null (absent), empty, or unknown tab resolves to
     * [LegacyAlertsDestination.Alerts].
     */
    fun destinationForTab(tab: String?): LegacyAlertsDestination = TAB_TO_DESTINATION[tab ?: DEFAULT_TAB] ?: LegacyAlertsDestination.Alerts

    /**
     * Resolves a raw location search string (e.g. `?tab=history&filter=foo`, with or without the leading `?`) to
     * its redirect target: the first `tab` value selects the destination, and every other param is forwarded in
     * its original order (web `params.delete('tab')`).
     */
    fun resolve(search: String?): LegacyAlertsTarget {
        val params = LegacyAlertsQuery.parse(search)
        val tab = params.firstOrNull { it.first == TAB_PARAM }?.second
        val forwarded = params.filterNot { it.first == TAB_PARAM }
        return LegacyAlertsTarget(destinationForTab(tab), forwarded)
    }
}

/**
 * A minimal application/x-www-form-urlencoded query codec mirroring the browser `URLSearchParams` used by the web
 * source. [parse] splits a search string into ordered key/value pairs (decoding `+`→space and percent escapes,
 * skipping empty segments, treating a bare `key` as `key=""`); [serialize] re-encodes them (web
 * `URLSearchParams.toString()`). Both tolerate malformed percent escapes by falling back to the raw text rather
 * than throwing, so a hand-crafted deep link can never crash the redirect.
 */
object LegacyAlertsQuery {
    private const val CHARSET = "UTF-8"
    private const val PAIR_SEPARATOR = "&"
    private const val KEY_VALUE_SEPARATOR = "="
    private const val LEADING_MARKER = "?"

    /** Parses [raw] (an optional leading `?` is dropped) into ordered, decoded key/value pairs. */
    fun parse(raw: String?): List<Pair<String, String>> {
        val body = raw?.removePrefix(LEADING_MARKER).orEmpty()
        if (body.isEmpty()) return emptyList()
        return body
            .split(PAIR_SEPARATOR)
            .filter { it.isNotEmpty() }
            .map { segment -> segment.toDecodedPair() }
    }

    /** Re-encodes [pairs] into a `key=value&key2=value2` string (web `URLSearchParams.toString()`). */
    fun serialize(pairs: List<Pair<String, String>>): String =
        pairs.joinToString(PAIR_SEPARATOR) { (key, value) ->
            encode(key) + KEY_VALUE_SEPARATOR + encode(value)
        }

    private fun String.toDecodedPair(): Pair<String, String> {
        val splitAt = indexOf(KEY_VALUE_SEPARATOR)
        if (splitAt < 0) return decode(this) to ""
        return decode(substring(0, splitAt)) to decode(substring(splitAt + 1))
    }

    private fun decode(value: String): String = runCatching { URLDecoder.decode(value, CHARSET) }.getOrDefault(value)

    private fun encode(value: String): String = runCatching { URLEncoder.encode(value, CHARSET) }.getOrDefault(value)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the tab, the
 * forwarded query, or any other location data — so a diagnostics line can never leak where a user was deep-linked.
 */
object LegacyAlertsRedirectDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "legacy-alerts-redirect"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LegacyAlertsRedirect"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
