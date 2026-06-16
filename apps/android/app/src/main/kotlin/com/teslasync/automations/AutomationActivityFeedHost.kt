// Page-host wiring for the AutomationActivityFeed A7 page surface — the seam that attaches real screen content
// to the page-host registry ([PageHosts]). It mirrors the sibling A7 precedent ([SlowQueriesPageHost] /
// [GasPriceAutoPollPageHost]): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]. The web surface is unrouted (it is embedded in the Automations
// page rather than mounted at its own path), so no generated Destination references it and it is reached by
// whatever host mounts it; the registration keeps the wiring in the standard A7 seam. [AutomationActivityFeedRoute]
// reads the app DI graph from [LocalDataContainer], binds the page to the local-state source, and performs no
// HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations.activityfeed

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the [AutomationActivityFeedPageRegistration.ROUTE_ID] seam.
 * Resolves the app data graph from the CompositionLocal, builds the local-state source, and binds the page to
 * the app's redacting logger. No HTTP touches the view.
 */
@Composable
fun AutomationActivityFeedRoute() {
    val container = LocalDataContainer.current
    val source = remember { automationActivityFeedSource() }
    AutomationActivityFeedPage(source = source, logger = container.logger)
}

/**
 * Registers the [AutomationActivityFeedRoute] host for this surface. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AutomationActivityFeedPageHost {
    private val id: String = AutomationActivityFeedPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AutomationActivityFeedRoute() }
    }
}
