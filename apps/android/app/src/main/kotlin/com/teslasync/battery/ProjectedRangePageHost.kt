// Page-host wiring for the ProjectedRangePage surface (A7) — the seam that attaches real screen content to the
// `projectedRange` ⁄ `/projected-range` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.battery.batteryhealth.BatteryHealthPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [ProjectedRangeRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared Settings
// holder + the app-scoped active-vehicle selection (and a page-local range-projection repository over the shared client
// + cache) via [projectedRangePageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.projectedrange

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `projectedRange` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local range-projection repository (constructed from the shared client
 * + offline cache the container exposes) + the shared Settings holder + the active-vehicle selection, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun ProjectedRangeRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            projectedRangePageSourceOf(
                repository = RangeProjectionRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    ProjectedRangePage(source = source, logger = container.logger)
}

/**
 * Registers the [ProjectedRangeRoute] host for the `projectedRange` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ProjectedRangePageHost {
    private val id: String = ProjectedRangePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ProjectedRangeRoute() }
    }
}
