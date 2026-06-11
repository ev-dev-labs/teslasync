package io.teslasync.android.widgets

import io.teslasync.android.navigation.RouteTable

/**
 * Builds the `teslasync://app/...` deep-link URI a widget tap opens (P3/A8, ADR-009). Every target is
 * validated against the real [RouteTable] — the same registry the navigation shell uses — so a widget
 * can never deep-link to a route that does not exist; an (impossible) unresolvable kind falls back to
 * the always-present dashboard. The URI is delivered to `MainActivity` through the same
 * `NotificationIntent.EXTRA_DEEP_LINK` channel the notification taps use (P3/A6), so it flows through
 * the one tested `DeepLinkRouter` → navigation path rather than a second bespoke mechanism.
 */
object WidgetDeepLinks {
    private const val DASHBOARD_PATH = "dashboard"

    /**
     * The `teslasync://app/<route>` URI for [kind]. The vehicle-status widget appends the at-a-glance
     * page's `?vehicle_id=` query (mirroring the web `GlancePage`) when [vehicleId] is known, so the
     * tap lands on the exact vehicle the widget was showing.
     */
    fun uri(
        kind: WidgetKind,
        vehicleId: Long? = null,
    ): String {
        val path = resolvedPath(kind)
        val base = "${RouteTable.APP_SCHEME}://app/$path"
        return if (kind == WidgetKind.VehicleStatus && vehicleId != null) "$base?vehicle_id=$vehicleId" else base
    }

    /** The validated in-app route path for [kind] (its declared path when real, else the dashboard). */
    fun resolvedPath(kind: WidgetKind): String {
        val candidate = kind.routePath
        val destination = RouteTable.match(candidate)
        return if (destination != null && destination.id != RouteTable.notFound.id) candidate else DASHBOARD_PATH
    }
}
