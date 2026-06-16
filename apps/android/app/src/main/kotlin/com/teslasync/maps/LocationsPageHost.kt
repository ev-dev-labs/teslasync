// Page-host wiring for the LocationsPage surface (A7) — the seam that attaches real screen content to the
// `locations` ⁄ `/locations` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [LocationsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the app-scoped
// active-vehicle selection and a page-local location repository (constructed over the shared resilient client +
// offline cache the container already exposes, since the Android DI graph wires no LocationsStore yet) via
// [locationsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.maps.locations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpLocationRepository

/**
 * The stateful route entry registered for the `locations` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection and a page-local location
 * repository (constructed from the shared client + offline cache the container exposes), and binds the page to the
 * app's redacting logger.
 */
@Composable
fun LocationsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            locationsPageSourceOf(
                locationRepository = HttpLocationRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    LocationsPage(source = source, logger = container.logger)
}

/**
 * Registers the [LocationsRoute] host for the `locations` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object LocationsPageHost {
    private val id: String = LocationsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { LocationsRoute() }
    }
}
