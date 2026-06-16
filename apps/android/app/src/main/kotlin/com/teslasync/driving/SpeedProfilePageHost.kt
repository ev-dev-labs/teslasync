// Page-host wiring for the SpeedProfilePage surface (A7) — the seam that attaches real screen content to the
// `speedProfile` ⁄ `/speed-profile` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [SpeedProfileRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// app-scoped active-vehicle selection, the shared settings holder, and a page-local driving repository
// (constructed over the shared resilient client + offline cache the container already exposes, since the Android
// DI graph wires no DrivingStore yet) via [speedProfilePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.speedprofile

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpDrivingRepository

/**
 * The stateful route entry registered for the `speedProfile` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the app-scoped active-vehicle selection, the shared settings holder and
 * a page-local driving repository (constructed from the shared client + offline cache the container exposes), and
 * binds the page to the app's redacting logger.
 */
@Composable
fun SpeedProfileRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            speedProfilePageSourceOf(
                drivingRepository = HttpDrivingRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
                settingsStore = container.settingsStore,
            )
        }
    SpeedProfilePage(source = source, logger = container.logger)
}

/**
 * Registers the [SpeedProfileRoute] host for the `speedProfile` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SpeedProfilePageHost {
    private val id: String = SpeedProfilePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SpeedProfileRoute() }
    }
}
