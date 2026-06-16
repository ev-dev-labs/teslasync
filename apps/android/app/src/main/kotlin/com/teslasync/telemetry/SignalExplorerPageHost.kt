// Page-host wiring for the SignalExplorerPage telemetry surface (A7) — the seam that attaches real screen content to
// the `signalExplorer` ⁄ `/signal-explorer` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [SignalExplorerRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S7 signals
// port (over the resilient client + offline cache) and the app-scoped vehicle selection via
// [signalExplorerPageSourceOf], and performs no HTTP itself — the view-model owns the page-local S8 SignalsStore.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signalexplorer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSignalsRepository

/**
 * The stateful route entry registered for the `signalExplorer` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local [HttpSignalsRepository] (constructed from the shared
 * resilient client + offline cache the container exposes) and the app-scoped vehicle selection, and binds the page
 * to the app's redacting logger.
 */
@Composable
fun SignalExplorerRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            signalExplorerPageSourceOf(
                signalsRepository = HttpSignalsRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    SignalExplorerPage(source = source, logger = container.logger)
}

/**
 * Registers the [SignalExplorerRoute] host for the `signalExplorer` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SignalExplorerPageHost {
    private val id: String = SignalExplorerPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SignalExplorerRoute() }
    }
}
