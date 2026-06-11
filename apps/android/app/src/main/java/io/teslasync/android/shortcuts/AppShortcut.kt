package io.teslasync.android.shortcuts

import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable

/**
 * One launcher app-shortcut (P3/A8): a stable [id], the canonical [destinationId] it deep-links to,
 * and a [rank] (lower = higher priority / shown first). Pure data with no Android/Compose types so the
 * whole matrix is covered by JVM unit tests; the icon and labels are resolved at the Android boundary
 * by [ShortcutPublisher], and the deep-link URI is derived from the real [RouteTable] so a shortcut can
 * never point at a route that does not exist.
 */
data class AppShortcut(
    val id: String,
    val destinationId: String,
    val rank: Int,
)

/**
 * The TeslaSync launcher-shortcut registry (P3/A8). Mirrors the most-used web entry points the spec
 * calls for — dashboard, vehicles, charging, live map, commands, notifications, search — each routed
 * through the A3 navigation graph. Every shortcut's deep link is built from its [Destination]'s real
 * registered URI ([RouteTable.deepLinkUris]) and delivered through the same
 * [io.teslasync.android.notifications.NotificationIntent.EXTRA_DEEP_LINK] channel the notification and
 * widget taps use, so it flows through the one tested `DeepLinkRouter` → navigation path rather than a
 * second bespoke mechanism. Framework-free and fully unit-tested.
 */
object AppShortcuts {
    /** Every shortcut in display/priority order (rank ascending). */
    val all: List<AppShortcut> =
        listOf(
            AppShortcut("dashboard", "dashboard", rank = 0),
            AppShortcut("vehicles", "vehicles", rank = 1),
            AppShortcut("charging", "charging", rank = 2),
            AppShortcut("liveMap", "liveMap", rank = 3),
            AppShortcut("commands", "commands", rank = 4),
            AppShortcut("notifications", "notificationsInbox", rank = 5),
            AppShortcut("search", "search", rank = 6),
        )

    /** The destination a [shortcut] opens, or null when its id is not a known destination. */
    fun destination(shortcut: AppShortcut): Destination? = Destinations.find(shortcut.destinationId)

    /** True when [shortcut] targets a real, navigable destination (not the not-found fallback). */
    fun isReal(shortcut: AppShortcut): Boolean {
        val destination = destination(shortcut) ?: return false
        return destination.id != RouteTable.notFound.id
    }

    /**
     * The `teslasync://app/...` deep-link URI a tap on [shortcut] opens. Derived from the destination's
     * own registered app-scheme deep link so it always matches a route the NavHost can resolve (the
     * dashboard resolves to `teslasync://app/`, `vehicles` to `teslasync://app/vehicles`, …).
     */
    fun deepLinkUri(shortcut: AppShortcut): String {
        val destination = destination(shortcut) ?: return fallbackUri()
        return RouteTable
            .deepLinkUris(destination)
            .firstOrNull { it.startsWith("${RouteTable.APP_SCHEME}://") }
            ?: fallbackUri()
    }

    /**
     * The shortcuts to publish, capped at the launcher's [max] per-activity limit, in rank order and
     * filtered to real destinations. A non-positive [max] publishes none (the platform reported no slots).
     */
    fun published(max: Int): List<AppShortcut> {
        if (max <= 0) return emptyList()
        return all.filter(::isReal).sortedBy { it.rank }.take(max)
    }

    private fun fallbackUri(): String =
        RouteTable
            .deepLinkUris(RouteTable.start)
            .first { it.startsWith("${RouteTable.APP_SCHEME}://") }
}
