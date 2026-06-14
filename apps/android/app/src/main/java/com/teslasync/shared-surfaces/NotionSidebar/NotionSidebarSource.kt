// The data seam the NotionSidebar surface binds to for the current route it highlights — the native analogue
// of the web `useLocation()` hook (web/src/components/layout/sidebar/NotionSidebar.tsx reads
// `location.pathname`). The view (composable) performs NO HTTP and never reaches into the navigation controller
// directly — it only collects state from the [NotionSidebarViewModel], which drives this seam (ADR-002),
// satisfying the "no direct HTTP / no router reach-through from the view" contract. The sidebar's other inputs
// (sections, pinned items, counts, the pin/unpin/select callbacks) are host-owned props passed straight into
// the composable, exactly as the web component receives them — they are not a fetched feed, so the only data
// seam this surface needs is the current route. In production a concrete adapter over the app's router
// state-holder (the current-[Destination] stream the scaffold already owns via `currentBackStackEntryAsState`)
// backs it; a test fake backs it in unit tests. Mirrors the dual-adapter shape of the sibling BottomTabBar
// surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/NotionSidebar) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `NotionSidebar*` filename cannot match the
// `NotionSidebarSource` seam plus its co-located extension adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import io.teslasync.android.navigation.Destination
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [NotionSidebarViewModel] depends on so it binds to an abstraction (real adapter <-> test
 * fake), never to a concrete navigation controller — the Android counterpart of the web `useLocation()` read.
 * [currentPath] is the live stream of the current route's path (the web `location.pathname`); the sidebar
 * highlights whichever entry owns it. No HTTP touches the view.
 */
fun interface NotionSidebarSource {
    /** The current route path as a live stream (web `useLocation().pathname`). */
    fun currentPath(): Flow<String>
}

/**
 * Binds the surface to the app's router state-holder — the current-[Destination] stream the navigation
 * scaffold already owns (P1/S8). Each destination's `webPath` is the route path the sidebar matches against, so
 * the native tree tracks navigation exactly as the web tree tracks `useLocation()`. No HTTP touches the view.
 */
fun Flow<Destination>.asNotionSidebarSource(): NotionSidebarSource {
    val destinations = this
    return NotionSidebarSource { destinations.map { it.webPath } }
}

/**
 * Builds a [NotionSidebarSource] from a raw current-path provider — the host wiring seam used when a caller
 * already has the route-path stream in hand (and the test double used to drive each route deterministically).
 * Mirrors the contract of the router adapter above.
 */
fun notionSidebarSource(currentPath: () -> Flow<String>): NotionSidebarSource = NotionSidebarSource { currentPath() }
