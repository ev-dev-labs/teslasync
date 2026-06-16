// Page-host wiring for the NavigationRoutePage surface (A7) — the seam that attaches real screen content to the
// `navigationRoute` ⁄ `/navigation` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.regenefficiency.RegenEfficiencyPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [NavigationRoutePageRoute] reads the app DI graph from [LocalDataContainer], binds the page to the app-scoped
// active-vehicle selection, the shared settings holder, a page-local vehicles repository (latest-snapshot +
// charging-telemetry reads) and a page-local location-history repository (both constructed over the shared resilient
// client + offline cache the container already exposes, since the Android DI graph wires no VehiclesStore-backed source
// here) via [navigationRoutePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.maps.navigationroute

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository

/**
 * The stateful route entry registered for the `navigationRoute` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection, the shared settings holder, a
 * page-local vehicles repository (the latest-snapshot + charging-telemetry reads) and a page-local location-history
 * repository (both over the shared client + offline cache the container exposes), and binds the page to the app's
 * redacting logger.
 */
@Composable
fun NavigationRoutePageRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            navigationRoutePageSourceOf(
                vehiclesRepository = HttpVehiclesRepository(container.api, container.cacheStore),
                locationHistoryRepository = HttpLocationHistoryRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
                settingsStore = container.settingsStore,
            )
        }
    NavigationRoutePage(source = source, logger = container.logger)
}

/**
 * Registers the [NavigationRoutePageRoute] host for the `navigationRoute` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object NavigationRoutePageHost {
    private val id: String = NavigationRoutePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { NavigationRoutePageRoute() }
    }
}
