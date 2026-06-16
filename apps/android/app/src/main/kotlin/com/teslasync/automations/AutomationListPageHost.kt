// Page-host wiring for the AutomationListPage surface (A7) — the seam that attaches real screen content to the
// `automationList` ⁄ `/automations/list` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.slowqueries.SlowQueriesPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [AutomationListRoute] reads the app DI graph from [LocalDataContainer], binds the page to
// the shared S8 [io.teslasync.shared.core.presentation.automations.AutomationsStore] via
// [asAutomationListSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations.list

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `automationList` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over the shared S8 Automations holder, and binds the page to the
 * app's redacting logger.
 */
@Composable
fun AutomationListRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.automationsStore.asAutomationListSource() }
    AutomationListPage(source = source, logger = container.logger)
}

/**
 * Registers the [AutomationListRoute] host for the `automationList` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AutomationListPageHost {
    private val id: String = AutomationListPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AutomationListRoute() }
    }
}
