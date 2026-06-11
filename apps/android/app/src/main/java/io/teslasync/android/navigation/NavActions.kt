package io.teslasync.android.navigation

import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController

/**
 * Navigates to [destination] using the right back-stack policy: top-level destinations reset to a
 * single back-stack entry (saving/restoring per-tab state, the standard Material pattern), while
 * deeper destinations are pushed with single-top to avoid duplicate copies.
 */
fun NavHostController.navigateTo(destination: Destination) {
    if (RouteTable.isTopLevel(destination)) {
        navigateTopLevel(destination)
    } else {
        navigate(destination.route) { launchSingleTop = true }
    }
}

/** Switches to a top-level destination, preserving and restoring each destination's saved state. */
fun NavHostController.navigateTopLevel(destination: Destination) {
    navigate(destination.route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
