// Page-host wiring for the VehicleAccessPage vehicles surface (A7) — the seam that attaches real screen content to
// the `vehicleAccess` ⁄ `/vehicles/:id/access` navigation destination (Destinations.kt). It mirrors the sibling
// parameterized-route precedents (TripDetailPageHost / ChargingDetailPageHost): [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [VehicleAccessRoute] reads the vehicle id from the route argument (web `useParams().id`), resolves the app
// DI graph from [LocalDataContainer], binds the page to the shared S8 VehiclesStore (for the vehicle read) + a
// page-local vehicle-access repository (constructed over the shared resilient client + offline cache the container
// exposes, since the Android DI graph wires no VehicleAccessStore yet) via [vehicleAccessPageSourceOf], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.vehicleaccess

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpVehicleAccessRepository

/**
 * The stateful route entry registered for the `vehicleAccess` destination. Reads the
 * [VehicleAccessPageRegistration.ARG_ID] argument from the route (web `useParams().id`), resolves the app data graph
 * from the CompositionLocal, builds the source over the shared VehiclesStore + a page-local vehicle-access repository
 * (constructed from the shared client + offline cache the container exposes), and binds the page to the app's
 * redacting logger.
 */
@Composable
fun VehicleAccessRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            vehicleAccessPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                accessRepository = HttpVehicleAccessRepository(container.api, container.cacheStore),
            )
        }
    val vehicleId =
        remember(entry) {
            entry.arguments?.getString(VehicleAccessPageRegistration.ARG_ID).orEmpty()
        }
    VehicleAccessPage(source = source, vehicleId = vehicleId, logger = container.logger)
}

/**
 * Registers the [VehicleAccessRoute] host for the `vehicleAccess` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object VehicleAccessPageHost {
    private val id: String = VehicleAccessPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> VehicleAccessRoute(entry) }
    }
}
