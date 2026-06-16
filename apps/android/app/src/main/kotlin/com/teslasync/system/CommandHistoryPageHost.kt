// Page-host wiring for the CommandHistoryPage system surface (A7) — the seam that attaches real screen content to
// the `commandHistory` ⁄ `/command-history` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.apilogs.ApiLogsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [CommandHistoryRoute] reads the app DI graph from [LocalDataContainer], builds the cache-then-network source
// over the shared S8 Vehicles + Commands holders via [commandHistorySourceOf], binds the app-scoped active-vehicle
// selection, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.commandhistory

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `commandHistory` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Commands holders, binds the
 * app-scoped selection, and hands the page the app's redacting logger.
 */
@Composable
fun CommandHistoryRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            commandHistorySourceOf(
                vehiclesStore = container.vehiclesStore,
                commandsStore = container.commandsStore,
            )
        }
    CommandHistoryPage(
        source = source,
        selection = container.selectedVehicleStore,
        logger = container.logger,
    )
}

/**
 * Registers the [CommandHistoryRoute] host for the `commandHistory` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object CommandHistoryPageHost {
    private val id: String = CommandHistoryPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { CommandHistoryRoute() }
    }
}
