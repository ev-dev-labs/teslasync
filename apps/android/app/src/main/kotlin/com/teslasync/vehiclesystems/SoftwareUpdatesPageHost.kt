// Page-host wiring for the SoftwareUpdatesPage vehicle-systems surface (A7) — the seam that attaches real screen
// content to the `softwareUpdates` ⁄ `/software-updates` (+ `/vehicle-systems/software`) navigation destination
// (Destinations.kt L106 / RouteTable.kt). It mirrors the sibling [io.teslasync.android.trips.triplist.TripListPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the
// route falls through to the shared not-found screen. [SoftwareUpdatesRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the app-scoped active-vehicle selection, the shared Vehicles holder, and a
// page-local VehicleSystems repository (constructed over the shared resilient client + offline cache the container
// already exposes, since the Android DI graph wires no VehicleSystemsStore yet) via [softwareUpdatesPageSourceOf], and
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.softwareupdates

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpVehicleSystemsRepository

/**
 * The stateful route entry registered for the `softwareUpdates` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection, the shared Vehicles holder and a
 * page-local VehicleSystems repository (constructed from the shared client + offline cache the container exposes), and
 * binds the page to the app's redacting logger.
 */
@Composable
fun SoftwareUpdatesRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            softwareUpdatesPageSourceOf(
                repository = HttpVehicleSystemsRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
                vehiclesStore = container.vehiclesStore,
            )
        }
    SoftwareUpdatesPage(source = source, logger = container.logger)
}

/**
 * Registers the [SoftwareUpdatesRoute] host for the `softwareUpdates` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SoftwareUpdatesPageHost {
    private val id: String = SoftwareUpdatesPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SoftwareUpdatesRoute() }
    }
}
