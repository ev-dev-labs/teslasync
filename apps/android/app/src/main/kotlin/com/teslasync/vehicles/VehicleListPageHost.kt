// Page-host wiring for the VehicleListPage fleet surface (A7) — the seam that attaches real screen content to the
// `vehicles` ⁄ `/vehicles` navigation destination (Destinations.kt L52). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [VehicleListRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// shared Vehicles + Pinned + Settings state holders the container already exposes via [vehicleListPageSourceOf],
// and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.vehiclelist

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `vehicles` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Vehicles + Pinned + Settings holders, and binds the page to
 * the app's redacting logger.
 */
@Composable
fun VehicleListRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            vehicleListPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                pinnedStore = container.pinnedStore,
                settingsStore = container.settingsStore,
            )
        }
    VehicleListPage(source = source, logger = container.logger)
}

/**
 * Registers the [VehicleListRoute] host for the `vehicles` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object VehicleListPageHost {
    private val id: String = VehicleListPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { VehicleListRoute() }
    }
}
