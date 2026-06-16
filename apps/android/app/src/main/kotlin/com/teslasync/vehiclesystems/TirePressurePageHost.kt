// Page-host wiring for the TirePressurePage vehicle-systems surface (A7) — the seam that attaches real screen content
// to the `tirePressure` ⁄ `/tire-pressure` navigation destination (Destinations.kt). It mirrors the sibling
// battery-page hosts: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [TirePressureRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 VehicleSystems
// + Settings holders + the app-scoped active-vehicle selection via [tirePressurePageSourceOf], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.tirepressure

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `tirePressure` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared VehicleSystems + Settings holders + the active-vehicle selection
 * via [tirePressurePageSourceOf], and binds the page to the app's redacting logger.
 */
@Composable
fun TirePressureRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            tirePressurePageSourceOf(
                vehicleSystemsStore = container.vehicleSystemsStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    TirePressurePage(source = source, logger = container.logger)
}

/**
 * Registers the [TirePressureRoute] host for the `tirePressure` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TirePressurePageHost {
    private val id: String = TirePressurePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TirePressureRoute() }
    }
}
