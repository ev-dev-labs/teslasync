// Pure, framework-free model + projection + diagnostics for the LegacyNotificationsRedirect feature view — the
// native analogue of the single thing the web component does before returning JSX
// (web/src/features/notifications/components/LegacyNotificationsRedirect.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, so the composable stays a
// thin render layer over the pure [LegacyNotificationsRedirectProjection].
//
// The web component is a smart, query-aware redirect from the legacy `/notifications?tab=…` route to the new
// top-level Notifications routes, forwarding the remaining search params so filter/search state survives:
//   /notifications                → /notifications/inbox
//   /notifications?tab=inbox      → /notifications/inbox
//   /notifications?tab=archived   → /notifications/archived
//   /notifications?tab=channels   → /notifications/channels
//   /notifications?tab=<unknown>  → /notifications/inbox   (web `TAB_TO_ROUTE[tab] ?? '/notifications/inbox'`)
// Its ONLY web hook is `useLocation` (it reads `location.search`); it binds NO data hook and performs NO fetch.
// As in the sibling QuickNav port (another zero-data-source surface), there is therefore no loading / error /
// empty / stale / offline lifecycle to model here: the resolution is total (the two `?? inbox` fallbacks mean it
// can never fail or resolve to "nothing"), and inventing those states would fabricate behaviour the web spec
// does not have (honesty covenant: no silent drift). What the surface genuinely varies is its RESOLUTION — which
// tab the legacy query selects and which params are forwarded — and that is exactly what this pure file owns:
//   • the tab → canonical Navigation-Compose route map — the web `TAB_TO_ROUTE` constant, with the same
//     Drives-style "leading slash removed" routes the app's [io.teslasync.android.navigation.Destinations] uses
//     (`notifications/inbox`, `notifications/archived`, `notifications/channels`);
//   • the `tab` lookup + default — the web `params.get('tab') ?? 'inbox'` then `TAB_TO_ROUTE[tab] ?? inbox`;
//   • the remaining-param forwarding — the web `params.delete('tab'); params.toString()`, reproduced with the
//     same application/x-www-form-urlencoded semantics `URLSearchParams` uses (see [LegacyQueryParams]).
//
// `useLocation` parity: the web reads the live router location; the host (P1/S8 navigation seam) hands this view
// the incoming legacy query string, so the view stays decoupled from the NavController exactly as the sibling
// QuickNav port emits a destination rather than navigating itself.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/LegacyNotificationsRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package identifier (a hyphen segment is illegal), so the package intentionally diverges from the
// path — exactly as the sibling QuickNav / RedisDiagnosticEmptyState surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacynotificationsredirect

import io.teslasync.shared.core.diagnostics.Logger
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * One legacy `?tab=` value the web `TAB_TO_ROUTE` recognises, paired with the canonical Navigation-Compose route
 * the redirect lands on. The [route] mirrors the web target path with its leading slash removed, matching the
 * route the app's [io.teslasync.android.navigation.Destinations] registers for the same Notifications page, so
 * the host can navigate to it directly.
 *
 * @property slug the legacy `tab` query value (web `TAB_TO_ROUTE` key).
 * @property route the Navigation-Compose route id (web target path minus its leading slash).
 */
enum class LegacyNotificationsTab(
    val slug: String,
    val route: String,
) {
    /** Web `{ inbox: '/notifications/inbox' }` — and the `?? 'inbox'` / `?? '/notifications/inbox'` default. */
    Inbox("inbox", "notifications/inbox"),

    /** Web `{ archived: '/notifications/archived' }`. */
    Archived("archived", "notifications/archived"),

    /** Web `{ channels: '/notifications/channels' }`. */
    Channels("channels", "notifications/channels"),
    ;

    companion object {
        /** The web double fallback target (`params.get('tab') ?? 'inbox'`, then `TAB_TO_ROUTE[tab] ?? inbox`). */
        val Default: LegacyNotificationsTab = Inbox

        /**
         * Resolves a raw `tab` value to its tab, falling back to [Default] for a missing or unrecognised value —
         * the native fusion of the web's two `?? inbox` defaults (absent `tab`, or a `tab` not in `TAB_TO_ROUTE`).
         */
        fun fromSlug(slug: String?): LegacyNotificationsTab = entries.firstOrNull { it.slug == slug } ?: Default
    }
}

/**
 * The resolved redirect target — the native analogue of the web `to` string handed to `<Navigate to={to} />`.
 * Pure data so the resolution is unit-tested without a UI host; the composable turns it into a real navigation.
 *
 * @property tab the destination tab the legacy query selected.
 * @property forwardedQuery the remaining (non-`tab`) params, re-serialised form-urlencoded with no leading `?`,
 *   or empty when none remain (web `params.delete('tab'); const qs = params.toString()`).
 */
data class LegacyNotificationsRedirectTarget(
    val tab: LegacyNotificationsTab,
    val forwardedQuery: String,
) {
    /** The canonical Navigation-Compose route, without any query (web `target`). */
    val route: String get() = tab.route

    /**
     * The full redirect path the host navigates to — the route with the forwarded query appended when non-empty
     * (web `to = qs ? `${target}?${qs}` : target`).
     */
    val routeWithQuery: String get() = if (forwardedQuery.isEmpty()) route else "$route?$forwardedQuery"
}

/**
 * The pure resolution from a legacy `/notifications` query string to its [LegacyNotificationsRedirectTarget] — a
 * 1:1 port of the web component body: read `tab` (default inbox), drop it from the params, map it to a target
 * route (default inbox), and forward whatever params remain. Side-effect-free, so every branch is verified
 * off-device.
 */
object LegacyNotificationsRedirectProjection {
    /** The query key the web reads then deletes (`params.get('tab')`, `params.delete('tab')`). */
    private const val TAB_PARAM = "tab"

    /**
     * Resolves the redirect target for a legacy location's [search] string (with or without a leading `?`, and
     * `null`/empty for a bare `/notifications`).
     *
     * Mirrors the web exactly: the FIRST `tab` value wins (web `URLSearchParams.get` returns the first), ALL
     * `tab` entries are dropped (web `URLSearchParams.delete` removes every occurrence), an absent or unknown
     * `tab` falls back to the inbox route, and the surviving params keep their original order.
     */
    fun resolve(search: String?): LegacyNotificationsRedirectTarget {
        val params = LegacyQueryParams.parse(search)
        val tabValue = params.firstOrNull { it.first == TAB_PARAM }?.second
        val remaining = params.filterNot { it.first == TAB_PARAM }
        return LegacyNotificationsRedirectTarget(
            tab = LegacyNotificationsTab.fromSlug(tabValue),
            forwardedQuery = LegacyQueryParams.serialize(remaining),
        )
    }
}

/**
 * A minimal, dependency-free re-implementation of the `URLSearchParams` parse/serialise behaviour the web
 * component relies on, so the param-forwarding logic is verified off-device without an Android `Uri` (which is
 * unavailable in the JVM unit gate). Parsing and serialising use application/x-www-form-urlencoded semantics
 * (the same encoding `URLSearchParams` uses): `+` decodes to space, percent-escapes decode to bytes, and
 * serialising re-encodes with `+` for spaces. This round-trips every realistic filter/search param 1:1 with the
 * web; the only divergence is a handful of sub-delimiters (`! ' ( ) ~ *`) that the JDK encoder escapes and
 * `URLSearchParams` leaves literal, none of which the notifications filters emit.
 */
internal object LegacyQueryParams {
    /**
     * Parses a query string into ordered key/value pairs, preserving order and duplicate keys and skipping empty
     * segments — matching how `URLSearchParams` ingests `location.search`. A segment with no `=` becomes a key
     * with an empty value (web `new URLSearchParams('a')` ⇒ `a=`).
     */
    fun parse(raw: String?): List<Pair<String, String>> {
        val trimmed = raw?.removePrefix("?").orEmpty()
        if (trimmed.isEmpty()) return emptyList()
        return trimmed
            .split("&")
            .filter { it.isNotEmpty() }
            .map { segment ->
                val eq = segment.indexOf('=')
                if (eq < 0) {
                    decode(segment) to ""
                } else {
                    decode(segment.substring(0, eq)) to decode(segment.substring(eq + 1))
                }
            }
    }

    /**
     * Serialises ordered key/value pairs back to a query string with no leading `?` — matching
     * `URLSearchParams.toString()`, which always emits `key=value` (even for an empty value) joined by `&`.
     */
    fun serialize(params: List<Pair<String, String>>): String =
        params.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }

    private fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries the surface [SLUG] and the resolved
 * destination [LegacyNotificationsTab.slug] — both fixed, non-user values (one of `inbox`/`archived`/`channels`)
 * — so a diagnostics line records where the legacy redirect landed without ever leaking user data.
 */
object LegacyNotificationsRedirectDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "legacy-notifications-redirect"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LegacyNotificationsRedirect"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"
    private const val TAB_KEY = "tab"

    /**
     * Emits the `view.opened` diagnostic for this surface, tagged with the resolved [tab] it redirected to. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened(
        logger: Logger,
        tab: LegacyNotificationsTab,
    ) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG, TAB_KEY to tab.slug))
    }
}
