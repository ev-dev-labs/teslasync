// Page-host wiring for the AutomationsListPage surface (A7) — the seam that attaches real screen content to the
// `automations` ⁄ `/automations` navigation destination (Destinations.kt). It mirrors the admin/ApiLogsPageHost
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [AutomationsListRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared S8 holders (AutomationsStore + VehiclesStore + PinnedStore)
// plus the resilient client for the import write via [automationsListSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `automations` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared holders (+ the import-write client), and binds the page to
 * the app's redacting logger.
 */
@Composable
fun AutomationsListRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            automationsListSource(
                automationsStore = container.automationsStore,
                vehiclesStore = container.vehiclesStore,
                pinnedStore = container.pinnedStore,
                api = container.api,
            )
        }
    AutomationsListPage(source = source, logger = container.logger)
}

/**
 * Registers the [AutomationsListRoute] host for the `automations` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AutomationsListPageHost {
    private val id: String = AutomationsListPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AutomationsListRoute() }
    }
}
