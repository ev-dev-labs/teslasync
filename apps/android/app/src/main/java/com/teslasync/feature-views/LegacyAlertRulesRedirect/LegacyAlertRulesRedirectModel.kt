// Pure, framework-free model + projection + diagnostics for the LegacyAlertRulesRedirect feature view — the
// native analogue of the redirect the web component owns
// (web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// LegacyAlertRulesRedirect is a redirect surface — the web component is a one-line route element:
//
//     const { search } = useLocation();
//     return <Navigate to={`/notifications/rules${search}`} replace />;
//
// It renders no chrome of its own; its single job is to send the legacy `/alert-rules` URL to the canonical
// `/notifications/rules` route, carrying any query string (`search`) across so a bookmarked
// `/alert-rules?tab=active` lands on `/notifications/rules?tab=active`. Its ONLY web hook is `useLocation`
// (read to recover `search`); it binds NO data hook and performs NO fetch. There is therefore no
// loading / error / stale / offline lifecycle to model — inventing those would fabricate behaviour the web
// spec does not have (honesty covenant: no silent drift). What the surface genuinely owns is the redirect
// computation, and this pure file owns exactly that derivation:
//   • the legacy source path — the web `<Route path="alert-rules">` (mounted under `/`, so `/alert-rules`);
//   • the canonical target — the web `to` ('/notifications/rules'), which is also the route the native
//     RouteTable already aliases `/alert-rules` onto (asserted against RouteTable + Destinations in the unit
//     test, so this port can never drift from the canonical navigation graph);
//   • the preserved query — the web `${search}` suffix, normalized and carried verbatim onto the target.
//
// `replace` parity: the web `<Navigate replace>` swaps the history entry instead of pushing one, so Back
// never returns to the dead `/alert-rules` URL. The native target carries
// [LegacyAlertRulesRedirectTarget.replace] = true; the host performs the pop-and-replace navigation (the view
// emits the target, never touches the NavController — the same decoupling the sibling QuickNav port uses).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LegacyAlertRulesRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling QuickNav / ToolCard surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertrulesredirect

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The current navigation location handed to the redirect — the native analogue of the web `useLocation()`
 * return value. The web component reads only its [search] (the query string), so this model carries only that
 * field; modelling `pathname`/`hash`/`state` would add inputs the surface never reads. [search] is the raw
 * query the way the browser exposes it: empty when there is none, or a leading-`?` string like `?tab=active`.
 */
data class LegacyLocation(
    val search: String = "",
) {
    companion object {
        /** No query string — the common case (a bare `/alert-rules` visit). */
        val None: LegacyLocation = LegacyLocation(search = "")
    }
}

/**
 * The computed redirect — the native analogue of the web `<Navigate to=... replace />` element. Pure data (no
 * Compose/Android types) so it is fully covered by the off-device unit gate; the composable fires it once and
 * the host performs the navigation.
 *
 * @property destinationId the canonical [io.teslasync.android.navigation.Destinations] id the legacy path
 *   resolves to (`notificationsRules`).
 * @property route the Navigation-Compose route of the target (`notifications/rules`) — the web `to` with its
 *   leading slash removed.
 * @property search the preserved query carried onto the target (web `${search}`): empty, or a leading-`?` string.
 * @property replace true — swap the history entry rather than push (web `replace`), so Back skips the legacy URL.
 */
data class LegacyAlertRulesRedirectTarget(
    val destinationId: String,
    val route: String,
    val search: String,
    val replace: Boolean,
) {
    /** Route + preserved query — the Nav-Compose form of the web redirect target `/notifications/rules${search}`. */
    val routeWithSearch: String get() = route + search

    /** Web-path form (leading slash), e.g. `/notifications/rules?tab=active`; cross-checked against RouteTable in tests. */
    val webTarget: String get() = "/$route$search"
}

/**
 * The static redirect projection — the native analogue of the web component's body. The web reads
 * `useLocation().search` and returns `<Navigate to={`/notifications/rules${search}`} replace />`; [resolve] is
 * exactly that, expressed as a pure transform from a [LegacyLocation] to a [LegacyAlertRulesRedirectTarget].
 *
 * The target constants mirror the web source verbatim (`/alert-rules` → `/notifications/rules`); the unit test
 * additionally asserts they agree with [io.teslasync.android.navigation.RouteTable] aliases +
 * [io.teslasync.android.navigation.Destinations], so the port stays locked to the canonical navigation graph.
 */
object LegacyAlertRulesRedirectProjection {
    /** The legacy source path — the web `<Route path="alert-rules">` (mounted under `/`, so `/alert-rules`). */
    const val LEGACY_PATH: String = "/alert-rules"

    /** The canonical target destination id (web `to` → the RouteTable alias target for [LEGACY_PATH]). */
    const val CANONICAL_DESTINATION_ID: String = "notificationsRules"

    /** The canonical target route — web `to: '/notifications/rules'` as a Navigation-Compose route (no slash). */
    const val CANONICAL_ROUTE: String = "notifications/rules"

    /**
     * Normalizes a raw query the way the web carries `useLocation().search` onto the target: an empty (or
     * blank) query stays empty; a present query keeps its leading `?` (added if a caller passes a bare
     * `tab=active`). Nothing else is altered — the query is preserved verbatim, matching web `${search}`.
     */
    fun normalizeSearch(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        return if (trimmed.startsWith("?")) trimmed else "?$trimmed"
    }

    /**
     * Computes the redirect for [location] — the web component's whole body: target `/notifications/rules`
     * with the location's [LegacyLocation.search] preserved, replacing the history entry. Total (always
     * returns a target); the composable's null-fallback guards only an unresolved override in tests so the
     * surface is never a blank box.
     */
    fun resolve(location: LegacyLocation): LegacyAlertRulesRedirectTarget =
        LegacyAlertRulesRedirectTarget(
            destinationId = CANONICAL_DESTINATION_ID,
            route = CANONICAL_ROUTE,
            search = normalizeSearch(location.search),
            replace = true,
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the query
 * string or any user data — so a diagnostics line can never leak where the user was headed.
 */
object LegacyAlertRulesRedirectDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "legacy-alert-rules-redirect"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LegacyAlertRulesRedirect"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
