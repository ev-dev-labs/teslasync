// Page-host wiring for the EnergyPage battery surface (A7) — the seam that attaches real screen content to the
// `energy` ⁄ `/energy` navigation destination (Destinations.kt). It mirrors the sibling analytics-page hosts:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls
// through to the shared not-found screen. [EnergyRoute] reads the app DI graph from [LocalDataContainer], binds the
// page to the shared S8 Energy + Vehicles + Settings holders + the app-scoped active-vehicle selection (and a
// page-local charging repository over the shared client + cache) via [energyPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.energy

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpChargingRepository

/**
 * The stateful route entry registered for the `energy` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local [HttpChargingRepository] (constructed from the shared client +
 * offline cache the container exposes) + the shared Energy/Vehicles/Settings holders + the active-vehicle selection,
 * and binds the page to the app's redacting logger.
 */
@Composable
fun EnergyRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            energyPageSourceOf(
                charging = HttpChargingRepository(container.api, container.cacheStore),
                energyStore = container.energyStore,
                vehiclesStore = container.vehiclesStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    EnergyPage(source = source, logger = container.logger)
}

/**
 * Registers the [EnergyRoute] host for the `energy` route. Called once at process start; idempotent so a repeat call
 * (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object EnergyPageHost {
    private val id: String = EnergyPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { EnergyRoute() }
    }
}
