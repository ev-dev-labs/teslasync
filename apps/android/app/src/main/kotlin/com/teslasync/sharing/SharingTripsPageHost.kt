// Page-host wiring for the SharingTripsPage surface (A7) — the seam that attaches real screen content to the
// `sharingTrips` ⁄ `/sharing/trips` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] / TripPlannerPageHost precedent: [register] is
// called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through
// to the shared not-found screen. [SharingTripsRoute] reads the app DI graph from [LocalDataContainer], binds the
// page to the app-scoped active-vehicle selection, the shared settings holder, and a page-local trips repository
// (constructed over the shared resilient client + offline cache the container already exposes, since the Android
// DI graph wires no TripsStore yet) via [sharingTripsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharing.sharingtrips

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTripsRepository

/**
 * The stateful route entry registered for the `sharingTrips` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection, the shared settings holder and
 * a page-local trips repository (constructed from the shared client + offline cache the container exposes), and
 * binds the page to the app's redacting logger.
 */
@Composable
fun SharingTripsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            sharingTripsPageSourceOf(
                tripsRepository = HttpTripsRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
                settingsStore = container.settingsStore,
            )
        }
    SharingTripsPage(source = source, logger = container.logger)
}

/**
 * Registers the [SharingTripsRoute] host for the `sharingTrips` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SharingTripsPageHost {
    private val id: String = SharingTripsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SharingTripsRoute() }
    }
}
