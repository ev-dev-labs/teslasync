// Page-host wiring for the BatteryCellsPage battery surface (A7) — the seam that attaches real screen content to the
// `batteryCells` ⁄ `/battery-cells` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.analytics.statistics.StatisticsPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [BatteryCellsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Settings holder + the app-scoped active-vehicle selection (and a page-local battery-cells repository over the shared
// client + cache) via [batteryCellsPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.batterycells

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `batteryCells` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the page-local battery-cells repository (constructed from the shared client
 * + offline cache the container exposes) + the shared Settings holder + the active-vehicle selection, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun BatteryCellsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            batteryCellsPageSourceOf(
                extras = BatteryCellsExtrasRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    BatteryCellsPage(source = source, logger = container.logger)
}

/**
 * Registers the [BatteryCellsRoute] host for the `batteryCells` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object BatteryCellsPageHost {
    private val id: String = BatteryCellsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { BatteryCellsRoute() }
    }
}
