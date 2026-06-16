// Page-host wiring for the StateMachineDebuggerPage surface (A7) — the seam that attaches real screen content to the
// `stateDebugger` ⁄ `/state-debugger` navigation destination (already declared at Destinations.kt
// `page("stateDebugger", "/state-debugger", NavGroup.System)`). It mirrors the sibling
// [io.teslasync.android.system.commands.CommandsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [StateMachineDebuggerRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared Vehicles
// holder + the app-scoped active-vehicle selection, and constructs a page-local
// [io.teslasync.shared.core.presentation.fsm.FsmStore] over the shared resilient client + offline cache the container
// exposes (the Android DI graph wires no FsmStore yet, exactly as the Commands / VehicleCommandCenter surfaces wire
// their page-local stores), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.statemachinedebugger

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpFsmRepository
import io.teslasync.shared.core.presentation.fsm.FsmStore

/**
 * The stateful route entry registered for the `stateDebugger` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 * + the app-scoped [io.teslasync.android.data.SelectedVehicleStore] plus a page-local [FsmStore] (constructed from the
 * shared client + offline cache, scoped to this route's composition), and binds the page to the app's redacting
 * logger.
 */
@Composable
fun StateMachineDebuggerRoute() {
    val container = LocalDataContainer.current
    val scope = rememberCoroutineScope()
    val source =
        remember(container, scope) {
            stateMachineDebuggerPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                selectedVehicleStore = container.selectedVehicleStore,
                fsmStore = FsmStore(HttpFsmRepository(container.api, container.cacheStore), scope),
                api = container.api,
            )
        }
    StateMachineDebuggerPage(source = source, logger = container.logger)
}

/**
 * Registers the [StateMachineDebuggerRoute] host for the `stateDebugger` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object StateMachineDebuggerPageHost {
    private val id: String = StateMachineDebuggerRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { StateMachineDebuggerRoute() }
    }
}
