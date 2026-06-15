// Page-host wiring for the GlancePage surface (A7) — the seam that attaches real screen content to the
// `glance` ⁄ `/glance` navigation destination (Destinations.kt L50). It mirrors the sibling
// [io.teslasync.android.charging.chargingcurve.ChargingCurvePageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [GlanceRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared
// Vehicles holder + the app-scoped active-vehicle selection, and constructs a page-local
// [io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore] over the shared resilient client +
// offline cache the container exposes (the Android DI graph wires no VehicleCommandStore yet, exactly as the
// CommandPalette / VehicleCommandCenter surfaces document), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.dashboard.glance

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpVehicleCommandRepository
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore

/**
 * The stateful route entry registered for the `glance` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 * + the app-scoped active-vehicle selection + a page-local command store (constructed from the shared client +
 * offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun GlanceRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            glancePageSourceOf(
                vehiclesStore = container.vehiclesStore,
                vehicleCommandStore = VehicleCommandStore(HttpVehicleCommandRepository(container.api, container.cacheStore)),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    GlancePage(source = source, logger = container.logger)
}

/**
 * Registers the [GlanceRoute] host for the `glance` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object GlancePageHost {
    private val id: String = GlancePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { GlanceRoute() }
    }
}
