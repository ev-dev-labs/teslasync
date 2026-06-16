// Page-host wiring for the QuickStatsPage dashboard surface (A7) — the seam that attaches real screen content to the
// `quickStats` ⁄ `/quick-stats` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.analytics.lifetimestats.LifetimeStatsPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [QuickStatsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared
// S8 Vehicles + Analytics + Settings holders via [quickStatsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/dashboard) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.dashboard.quickstats

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `quickStats` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Analytics + Settings holders, and
 * binds the page to the app's redacting logger.
 */
@Composable
fun QuickStatsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            quickStatsPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                analyticsStore = container.analyticsStore,
                settingsStore = container.settingsStore,
            )
        }
    QuickStatsPage(source = source, logger = container.logger)
}

/**
 * Registers the [QuickStatsRoute] host for the `quickStats` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object QuickStatsPageHost {
    private val id: String = QuickStatsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { QuickStatsRoute() }
    }
}
