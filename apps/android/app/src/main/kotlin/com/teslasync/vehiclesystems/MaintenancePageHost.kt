// Page-host wiring for the MaintenancePage vehicle-systems surface (A7) — the seam that attaches real screen content
// to the `maintenance` ⁄ `/maintenance` navigation destination (Destinations.kt). It mirrors the sibling
// BatteryHealthPageHost precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [MaintenanceRoute] resolves the app DI graph from [LocalDataContainer], binds the page to the shared Settings holder
// + the app-scoped active-vehicle selection + a page-local maintenance repository (constructed from the shared client
// + offline cache the container exposes) via [maintenancePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.maintenance

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `maintenance` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Settings holder + the active-vehicle selection + a page-local
 * maintenance repository (constructed from the shared client + offline cache the container exposes), and binds the
 * page to the app's redacting logger.
 */
@Composable
fun MaintenanceRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            maintenancePageSourceOf(
                repository = MaintenanceRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    MaintenancePage(source = source, logger = container.logger)
}

/**
 * Registers the [MaintenanceRoute] host for the `maintenance` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object MaintenancePageHost {
    private val id: String = MaintenancePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { MaintenanceRoute() }
    }
}
