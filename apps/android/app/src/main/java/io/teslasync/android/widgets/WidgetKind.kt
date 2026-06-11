package io.teslasync.android.widgets

/**
 * The four TeslaSync home-screen widgets (P3/A8, ADR-009/013). Each is a small, at-a-glance view of
 * cached shared-core state that deep-links into the full app.
 *
 * This enum is the framework-free identity used everywhere a widget must be named without touching
 * Glance or Android: the deep-link target ([routePath]), the unique WorkManager / Glance-state keys
 * ([uniqueName]), and the test matrix. The Glance layer maps each kind to its `GlanceAppWidget`.
 *
 * @property routePath the in-app Navigation-Compose path (no leading slash) a tap opens. It is always
 *   validated against the real `RouteTable` before a deep-link URI is built, so a widget can never
 *   point at a route that does not exist.
 * @property uniqueName the stable, persisted discriminator for this widget's background-refresh work
 *   and its Glance preferences partition. It MUST NOT change once shipped.
 */
enum class WidgetKind(
    val routePath: String,
    val uniqueName: String,
) {
    /** Vehicle status: SOC, range, drive/charge/park state, freshness. Opens the at-a-glance page. */
    VehicleStatus(routePath = "glance", uniqueName = "vehicle_status"),

    /** Charging: plugged/charging, power, ETA, SOC, last-session summary. Opens the charging page. */
    Charging(routePath = "charging", uniqueName = "charging"),

    /** Quick stats: fleet energy, cost, distance, efficiency. Opens the quick-stats page. */
    QuickStats(routePath = "quick-stats", uniqueName = "quick_stats"),

    /** Alerts: critical/unread counts, latest alert, quiet-hours indication. Opens the alerts page. */
    Alerts(routePath = "notifications/alerts", uniqueName = "alerts"),
}
