// Page-host wiring for the StatisticsPage analytics surface (A7) — the seam that attaches real screen content to the
// `statistics` ⁄ `/statistics` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.analytics.lifetimestats.LifetimeStatsPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [StatisticsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Energy +
// Analytics + Settings holders + the app-scoped active-vehicle selection (and a page-local period-stats repository
// over the shared client + cache) via [statisticsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.statistics

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `statistics` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the page-local period-stats repository (constructed from the shared client +
 * offline cache the container exposes) + the shared Energy/Analytics/Settings holders + the active-vehicle selection,
 * and binds the page to the app's redacting logger.
 */
@Composable
fun StatisticsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            statisticsPageSourceOf(
                extras = StatisticsExtrasRepository(container.api, container.cacheStore),
                energyStore = container.energyStore,
                analyticsStore = container.analyticsStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    StatisticsPage(source = source, logger = container.logger)
}

/**
 * Registers the [StatisticsRoute] host for the `statistics` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object StatisticsPageHost {
    private val id: String = StatisticsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { StatisticsRoute() }
    }
}
