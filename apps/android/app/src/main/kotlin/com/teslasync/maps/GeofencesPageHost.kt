// Page-host wiring for the GeofencesPage maps surface (A7) — the seam that attaches real screen content to the
// `geofences` ⁄ `/geofences` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [GeofencesRoute] reads the app DI graph from [LocalDataContainer], binds the page to page-local shared
// repositories (constructed over the shared resilient client + offline cache the container already exposes, since
// the Android DI graph wires no LocationsStore yet) via [geofencesPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.maps.geofences

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpLocationRepository
import io.teslasync.shared.core.data.repo.HttpPinnedRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository

/**
 * The stateful route entry registered for the `geofences` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over page-local shared repositories (constructed from the shared client +
 * offline cache the container exposes) and the resilient client, and binds the page to the app's redacting logger.
 */
@Composable
fun GeofencesRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            geofencesPageSourceOf(
                locationRepository = HttpLocationRepository(container.api, container.cacheStore),
                vehiclesRepository = HttpVehiclesRepository(container.api, container.cacheStore),
                pinnedRepository = HttpPinnedRepository(container.api, container.cacheStore),
                api = container.api,
            )
        }
    GeofencesPage(source = source, logger = container.logger)
}

/**
 * Registers the [GeofencesRoute] host for the `geofences` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object GeofencesPageHost {
    private val id: String = GeofencesPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { GeofencesRoute() }
    }
}
