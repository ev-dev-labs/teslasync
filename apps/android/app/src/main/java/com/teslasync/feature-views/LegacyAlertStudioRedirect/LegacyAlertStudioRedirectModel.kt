// Pure, framework-free model + projection + diagnostics for the LegacyAlertStudioRedirect feature view — the
// native analogue of the synchronous redirect the web component owns
// (web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The web component is a legacy-route bridge. Mounted at `/alert-studio`, it reads the current URL's query
// string and immediately redirects to `/notifications/studio`, preserving that query string verbatim and
// REPLACING the history entry so the back button skips the dead legacy URL:
//
//     const { search } = useLocation();
//     return <Navigate to={`/notifications/studio${search}`} replace />;
//
// This keeps existing draft-restore deep links + email CTAs (e.g. `/alert-studio?rule=42`,
// `/alert-studio?signals=…&from=signal-diff`, `/alert-studio?id=42`) working after the route moved under the
// notifications section. The full studio page lives at `/notifications/studio` (web `AlertStudioPage`).
//
// useLocation mapping: the web hook is react-router's URL-location hook (`{ pathname, search, hash }`) — NOT the
// `useLocations` geographic-data hook (which has a shared S8 store). It is navigation-framework state, not a data
// source, so — exactly as the sibling QuickNav port binds NO data store for its only hook (`useTranslation`) —
// this surface binds no S8 store and performs no fetch. The incoming query string is supplied by the host from
// the current Navigation-Compose back-stack entry (the platform analogue of `useLocation().search`); this pure
// model turns it into the redirect target, and the composable emits that target for the host to navigate.
//
// Decoupling: the web `<Navigate replace>` becomes a one-shot target this surface emits through the composable's
// `onRedirect` callback; the host performs the actual (replace) navigation. The view never touches the
// NavController — the same decoupling the sibling QuickNav port uses for its `onNavigate` callback.
//
// Lifecycle states: the web source performs NO data fetch and has NO async, error, empty, stale, or offline
// branch — it is a pure synchronous redirect. Modelling those data-lifecycle states would fabricate behaviour
// the web spec does not have (honesty covenant: no parity shortcuts, no silent drift), exactly as the sibling
// QuickNav port documents for its own zero-data-source surface. What the surface genuinely has is one transient
// "redirecting" moment — rendered by the composable as the brand page-loader (the native analogue of the web
// Suspense/route fallback shown while the lazy redirect chunk loads) — plus this deterministic, always-valid
// target projection (so there is no error/empty path to invent).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LegacyAlertStudioRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling QuickNav / ToolCard surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertstudioredirect

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The resolved redirect this surface emits — the native analogue of the web `<Navigate to={…} replace />`. Pure
 * data (no Compose/Android types) so it is fully covered by the off-device unit gate; the host reads it from the
 * composable's `onRedirect` callback and performs the navigation.
 *
 * @property destinationId the canonical [io.teslasync.android.navigation.Destinations] id of the target
 *   (`notificationsStudio`), so the host can resolve chrome/auth metadata for the destination.
 * @property route the Navigation-Compose route pattern of the target, no leading slash (web
 *   `/notifications/studio` → `notifications/studio`); matches the canonical destination's `route`.
 * @property query the preserved query string, canonicalised to either empty or a single leading `?` (web
 *   `useLocation().search`); carries the legacy deep-link params (`rule`, `signals`, `id`, …) verbatim.
 * @property routeWithQuery [route] + [query] — the exact string the host passes to `NavController.navigate`.
 * @property webPath the web-parity absolute path + query (web `/notifications/studio${search}`); used by the
 *   diagnostics/tests to assert parity with the web `<Navigate to>` target.
 * @property replace whether the host should replace the current back-stack entry rather than push (web
 *   `replace`) — always `true`, so the dead legacy URL is dropped from history.
 */
data class LegacyAlertStudioRedirectTarget(
    val destinationId: String,
    val route: String,
    val query: String,
    val routeWithQuery: String,
    val webPath: String,
    val replace: Boolean,
)

/**
 * The redirect projection — the native analogue of the constant target the web component builds before returning
 * `<Navigate>`. LegacyAlertStudioRedirect has no data source, so the "projection" is a deterministic transform of
 * the incoming query string rather than of fetched data; it is exposed (and unit-tested) here so the composable
 * never hard-codes the target inline and the route / web-path / query-preservation logic is verified off-device.
 */
object LegacyAlertStudioRedirectProjection {
    /** Canonical [io.teslasync.android.navigation.Destinations] id of the redirect target. */
    const val TARGET_DESTINATION_ID: String = "notificationsStudio"

    /** Navigation-Compose route of the target, no leading slash (web `/notifications/studio`). */
    const val TARGET_ROUTE: String = "notifications/studio"

    /** Web-parity absolute path of the target (web `<Navigate to>` base, before the preserved query). */
    const val TARGET_WEB_PATH: String = "/notifications/studio"

    /**
     * Canonicalises an incoming query string to the web `useLocation().search` shape: empty when there are no
     * params, otherwise exactly one leading `?` followed by the verbatim parameter list. Tolerates a host that
     * passes the string with or without the leading `?`/`&` (the back-stack entry may expose either), and treats
     * a blank or bare-`?` query as "no params" so the target never carries a meaningless empty `?`.
     *
     * The inner parameter list is preserved byte-for-byte (order, encoding, multiple params), exactly as the web
     * component concatenates `search` onto the target — only the leading delimiter is normalised.
     */
    fun normalizeQuery(rawSearch: String): String {
        val stripped = rawSearch.trim().trimStart('?', '&')
        return if (stripped.isEmpty()) "" else "?$stripped"
    }

    /**
     * Builds the redirect target for an incoming query string — the native analogue of the web
     * `to={`/notifications/studio${search}`}`. Always produces a valid target (there is no failure mode), with
     * [LegacyAlertStudioRedirectTarget.replace] always `true` (web `replace`).
     */
    fun target(rawSearch: String): LegacyAlertStudioRedirectTarget {
        val query = normalizeQuery(rawSearch)
        return LegacyAlertStudioRedirectTarget(
            destinationId = TARGET_DESTINATION_ID,
            route = TARGET_ROUTE,
            query = query,
            routeWithQuery = TARGET_ROUTE + query,
            webPath = TARGET_WEB_PATH + query,
            replace = true,
        )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the query
 * string (which may hold user-meaningful values such as a rule id or a signal list) — so a diagnostics line can
 * never leak anything about the user or where they are being routed.
 */
object LegacyAlertStudioRedirectDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "legacy-alert-studio-redirect"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LegacyAlertStudioRedirect"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
