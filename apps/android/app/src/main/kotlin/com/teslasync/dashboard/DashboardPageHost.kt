// Page-host wiring for the DashboardPage surface (A7) — the seam that attaches real screen content to the
// `dashboard` ⁄ `/` (home) navigation destination (Destinations.kt L48). It mirrors the sibling A7 page-host
// precedents: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [DashboardRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared S8 Settings + Vehicles stores via [dashboardPageSourceOf],
// and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.dashboard.dashboard

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `dashboard` destination (the home `/` route). Resolves the app
 * data graph from the CompositionLocal, builds the source over the shared S8 Settings (auth-status) + Vehicles
 * (sync) stores, and binds the page to the app's redacting logger.
 */
@Composable
fun DashboardRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            dashboardPageSourceOf(
                settingsStore = container.settingsStore,
                vehiclesStore = container.vehiclesStore,
            )
        }
    DashboardPage(source = source, logger = container.logger)
}

/**
 * Registers the [DashboardRoute] host for the `dashboard` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DashboardPageHost {
    private val id: String = DashboardPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DashboardRoute() }
    }
}
