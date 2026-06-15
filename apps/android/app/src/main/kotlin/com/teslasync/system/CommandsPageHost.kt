// Page-host wiring for the CommandsPage surface (A7) — the seam that attaches real screen content to the
// `commands` ⁄ `/commands` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.dashboard.glance.GlancePageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [CommandsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared Vehicles holder,
// and constructs page-local [io.teslasync.shared.core.data.repo.HttpCommandsRepository] +
// [io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore] over the shared resilient client +
// offline cache the container exposes (the Android DI graph wires neither yet, exactly as the Glance /
// VehicleCommandCenter surfaces document), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.commands

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpCommandsRepository
import io.teslasync.shared.core.data.repo.HttpVehicleCommandRepository
import io.teslasync.shared.core.presentation.vehiclecommand.VehicleCommandStore

/**
 * The stateful route entry registered for the `commands` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 * plus a page-local commands repository + command store (constructed from the shared client + offline cache the
 * container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun CommandsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            commandsPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                commandsRepository = HttpCommandsRepository(container.api, container.cacheStore),
                vehicleCommandStore =
                    VehicleCommandStore(HttpVehicleCommandRepository(container.api, container.cacheStore)),
            )
        }
    CommandsPage(source = source, logger = container.logger)
}

/**
 * Registers the [CommandsRoute] host for the `commands` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object CommandsPageHost {
    private val id: String = CommandsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { CommandsRoute() }
    }
}
