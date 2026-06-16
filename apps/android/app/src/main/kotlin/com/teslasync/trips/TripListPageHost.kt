// Page-host wiring for the TripListPage trips surface (A7) — the seam that attaches real screen content to the
// `trips` ⁄ `/trips` navigation destination (Destinations.kt L65). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [TripListRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// app-scoped active-vehicle selection, the shared settings holder, and a page-local trips repository
// (constructed over the shared resilient client + offline cache the container already exposes, since the Android
// DI graph wires no TripsStore yet) via [tripListPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.trips.triplist

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTripsRepository

/**
 * The stateful route entry registered for the `trips` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection, the shared settings holder
 * and a page-local trips repository (constructed from the shared client + offline cache the container exposes),
 * and binds the page to the app's redacting logger.
 */
@Composable
fun TripListRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            tripListPageSourceOf(
                tripsRepository = HttpTripsRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
                settingsStore = container.settingsStore,
            )
        }
    TripListPage(source = source, logger = container.logger)
}

/**
 * Registers the [TripListRoute] host for the `trips` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TripListPageHost {
    private val id: String = TripListPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TripListRoute() }
    }
}
