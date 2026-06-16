// Page-host wiring for the DrivingDynamicsPage driving surface (A7) — the seam that attaches real screen content
// to the `drivingDynamics` ⁄ `/driving-dynamics` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.analytics.statistics.StatisticsPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [DrivingDynamicsRoute] reads the app DI graph from [LocalDataContainer], binds the page to
// the shared S8 Vehicles holder + the app-scoped active-vehicle selection (and page-local Driving + Telemetry
// repositories over the shared client + offline cache, since the Android DI graph wires no store for them yet)
// via [drivingDynamicsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.drivingdynamics

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpDrivingRepository
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `drivingDynamics` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Vehicles holder + the active-vehicle selection + page-local
 * Driving + Telemetry repositories (constructed from the shared client + offline cache the container exposes),
 * and binds the page to the app's redacting logger.
 */
@Composable
fun DrivingDynamicsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            drivingDynamicsPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                drivingRepository = HttpDrivingRepository(container.api, container.cacheStore),
                telemetryRepository = HttpTelemetryRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    DrivingDynamicsPage(source = source, logger = container.logger)
}

/**
 * Registers the [DrivingDynamicsRoute] host for the `drivingDynamics` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DrivingDynamicsPageHost {
    private val id: String = DrivingDynamicsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DrivingDynamicsRoute() }
    }
}
