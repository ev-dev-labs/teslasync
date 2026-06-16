// Page-host wiring for the FleetComparePage analytics surface (A7) — the seam that attaches real screen content
// to the `fleetCompare` ⁄ `/vehicle-comparison` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [FleetCompareRoute] reads the app DI graph from [LocalDataContainer], binds the page to the
// shared S8 Vehicles + Analytics + Driving + Settings holders via [fleetCompareSourceOf], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.fleetcompare

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `fleetCompare` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Analytics + Driving +
 * Settings holders, and binds the page to the app's redacting logger. The disambiguation banner's period-compare
 * CTA is left to the host's default no-op navigation seam (no `LocalNavController` is exposed app-wide).
 */
@Composable
fun FleetCompareRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            fleetCompareSourceOf(
                vehiclesStore = container.vehiclesStore,
                analyticsStore = container.analyticsStore,
                drivingStore = container.drivingStore,
                settingsStore = container.settingsStore,
            )
        }
    FleetComparePage(source = source, logger = container.logger)
}

/**
 * Registers the [FleetCompareRoute] host for the `fleetCompare` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object FleetComparePageHost {
    private val id: String = FleetComparePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { FleetCompareRoute() }
    }
}
