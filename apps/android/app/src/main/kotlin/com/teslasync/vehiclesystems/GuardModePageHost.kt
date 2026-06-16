// Page-host wiring for the GuardModePage surface (A7) — the seam that attaches real screen content to the
// `guardMode` ⁄ `/guard-mode` navigation destination (Destinations.kt L108). It mirrors the sibling
// [io.teslasync.android.maps.locations.LocationsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [GuardModeRoute] reads the app DI graph from [LocalDataContainer], binds the page to the app-scoped active-vehicle
// selection and page-local Guard / Vehicles / Location repositories (constructed over the shared resilient client +
// offline cache the container already exposes, since the Android DI graph wires no GuardStore yet) via
// [guardModePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpGuardRepository
import io.teslasync.shared.core.data.repo.HttpLocationRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository

/**
 * The stateful route entry registered for the `guardMode` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection and page-local Guard / Vehicles /
 * Location repositories (constructed from the shared client + offline cache the container exposes), and binds the page
 * to the app's redacting logger.
 */
@Composable
fun GuardModeRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            guardModePageSourceOf(
                guardRepository = HttpGuardRepository(container.api, container.cacheStore),
                vehiclesRepository = HttpVehiclesRepository(container.api, container.cacheStore),
                locationRepository = HttpLocationRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    GuardModePage(source = source, logger = container.logger)
}

/**
 * Registers the [GuardModeRoute] host for the `guardMode` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object GuardModePageHost {
    private val id: String = GuardModePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { GuardModeRoute() }
    }
}
