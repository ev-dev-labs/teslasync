// Page-host wiring for the DashboardsPage power-user surface (A7) — the seam that attaches real screen content to the
// `powerDashboards` ⁄ `/power/dashboards` navigation destination (Destinations.kt). It mirrors the sibling A7 page
// hosts: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the
// route falls through to the shared not-found screen. [DashboardsRoute] reads the app DI graph from
// [LocalDataContainer] for the redacting logger and performs no HTTP — the surface renders from local UI state + the
// static curated catalog only.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.dashboards

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `powerDashboards` destination. Resolves the app data graph from the
 * CompositionLocal and binds the page to the app's redacting logger.
 */
@Composable
fun DashboardsRoute() {
    val container = LocalDataContainer.current
    DashboardsPage(logger = container.logger)
}

/**
 * Registers the [DashboardsRoute] host for the `powerDashboards` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DashboardsPageHost {
    private val id: String = DashboardsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DashboardsRoute() }
    }
}
