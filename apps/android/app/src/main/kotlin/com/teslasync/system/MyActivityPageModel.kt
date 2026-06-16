// Pure, framework-free metadata + derivations for the MyActivityPage system surface — the native analogue of the
// cross-cutting concerns the web page owns (web/src/features/system/pages/MyActivityPage.tsx, the per-user
// activity-feed screen mounted at /me/activity). No Compose, no Android framework, no HTTP lives here, so the
// route identity, the default 30-day window the web seeds its range with, the query-params projection, and the
// HTTP-status guards that switch the feature-disabled (503) / identity-required (401) surfaces are all exercised
// off-device and the composable stays a thin render layer.
//
// The web page reads `useMyRecentActivity({ start, end, limit })` over a date window that defaults to the last
// thirty days (`today - 29 … today`), caps the result at two hundred rows, and renders the audit feed unless the
// read fails with a 503 (ForwardAuth not configured ⇒ feature disabled) or a 401 (no identity header ⇒ identity
// required), each surfaced as its own explanatory empty state. Those four derivations (the default range, the
// params projection, and the two status guards) are reproduced here as pure functions.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling system page
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.myactivity

import io.teslasync.android.sharedsurfaces.rangepicker.RangePickerValue
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.MyActivityParams
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Canonical metadata for the MyActivityPage surface. The web page is a top-level system route, so this object
 * carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires
 * (already a metadata-only destination at Destinations.kt `page("myActivity", "/me/activity", NavGroup.System)`),
 * the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11), the [DEFAULT_WINDOW_DAYS] the
 * web seeds its range with, and the [ACTIVITY_LIMIT] row cap the web read hook passes.
 */
object MyActivityPageRegistration {
    /** The navigation destination id (Destinations.kt `page("myActivity", "/me/activity", NavGroup.System)`). */
    const val ROUTE_ID: String = "myActivity"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/me/activity"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MyActivityPage"

    /** The default look-back window in days — the web `DEFAULT_WINDOW_DAYS = 30`. */
    const val DEFAULT_WINDOW_DAYS: Int = 30

    /** The maximum rows the feed requests — the web `ACTIVITY_LIMIT = 200` (the backend caps at 200). */
    const val ACTIVITY_LIMIT: Int = 200

    /**
     * HTTP 503 — the deployment is not running behind a ForwardAuth identity provider, so the per-user activity
     * endpoint refuses to serve (web `apiError?.status === 503` ⇒ the "Activity feed disabled" surface).
     */
    const val HTTP_FEATURE_DISABLED: Int = 503

    /**
     * HTTP 401 — the request carried no identity header (web `apiError?.status === 401` ⇒ the "Identity
     * required" surface).
     */
    const val HTTP_UNAUTHENTICATED: Int = 401
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

private val ISO_DATE: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no activity data. */
internal fun recordMyActivityPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to MyActivityPageRegistration.SLUG))
}

/**
 * The default committed range the page opens with — the native port of the web `defaults` memo: an inclusive
 * window ending today and starting `DEFAULT_WINDOW_DAYS - 1` days earlier (so today + the prior 29 days = a
 * 30-day window), computed in the device [zone] from the [nowMillis] wall clock. Both bounds are local calendar
 * `YYYY-MM-DD` strings, never instants, so the window never shifts across time zones.
 */
fun defaultActivityRange(
    nowMillis: Long,
    zone: ZoneId,
): RangePickerValue {
    val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
    val start = today.minusDays((MyActivityPageRegistration.DEFAULT_WINDOW_DAYS - 1).toLong())
    return RangePickerValue(start = start.format(ISO_DATE), end = today.format(ISO_DATE))
}

/**
 * Projects a committed [range] onto the `GET /users/me/activity` query parameters — the native port of the web
 * `useMyRecentActivity({ start, end, limit })` argument: the inclusive ISO bounds plus the [ACTIVITY_LIMIT] row
 * cap. The shared `userActivityCacheKey` keys each params set independently, so changing the range re-reads.
 */
fun activityParamsFor(range: RangePickerValue): MyActivityParams =
    MyActivityParams(
        start = range.start,
        end = range.end,
        limit = MyActivityPageRegistration.ACTIVITY_LIMIT,
    )

/**
 * Whether [status] is the feature-disabled (503) failure the web surfaces as the "Activity feed disabled" empty
 * state — the per-user endpoint refusing to serve because the deployment is not behind ForwardAuth.
 */
fun isFeatureDisabled(status: Int?): Boolean = status == MyActivityPageRegistration.HTTP_FEATURE_DISABLED

/**
 * Whether [status] is the unauthenticated (401) failure the web surfaces as the "Identity required" empty state —
 * the request carrying no identity header.
 */
fun isUnauthenticated(status: Int?): Boolean = status == MyActivityPageRegistration.HTTP_UNAUTHENTICATED
