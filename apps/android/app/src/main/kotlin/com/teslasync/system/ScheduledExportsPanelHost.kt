// Page-host wiring for the ScheduledExportsPanel system surface (A7) — the seam that attaches real screen content to
// the `ScheduledExportsPanel` Navigation-Compose destination. The web page is UNROUTED (mounted inside /data-export,
// so no App.tsx route and no [io.teslasync.android.navigation.Destinations] row), so TeslaSyncNavHost registers an
// explicit standalone `composable("ScheduledExportsPanel")` destination that resolves through
// [io.teslasync.android.navigation.PageHosts]; this host registers the content for that key. It mirrors the sibling
// [io.teslasync.android.system.diagnostic.DiagnosticPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [ScheduledExportsPanelRoute] reads the app DI graph from [LocalDataContainer] and binds the page to a page-local
// shared [io.teslasync.shared.core.data.repo.HttpExportsRepository] over the resilient client + offline cache the
// container exposes (the Android DI graph wires no Exports store yet, exactly as the sibling Commands / Diagnostic
// surfaces document), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.scheduledexports

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.scheduledexportspanel.scheduledExportsPanelSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpExportsRepository

/**
 * The stateful route entry registered for the `ScheduledExportsPanel` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over a page-local [HttpExportsRepository] (constructed from the shared
 * resilient client + offline cache the container exposes — so refresh/retry force a genuine cache-then-network
 * re-fetch, the web `refetch()` behaviour), and binds the page to the app's redacting logger.
 */
@Composable
fun ScheduledExportsPanelRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            scheduledExportsPanelSource(HttpExportsRepository(container.api, container.cacheStore))
        }
    ScheduledExportsPanelPage(source = source, logger = container.logger)
}

/**
 * Registers the [ScheduledExportsPanelRoute] host for the `ScheduledExportsPanel` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ScheduledExportsPanelPageHost {
    private val id: String = ScheduledExportsPanelPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ScheduledExportsPanelRoute() }
    }
}
