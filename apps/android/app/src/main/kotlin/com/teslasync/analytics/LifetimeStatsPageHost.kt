// Page-host wiring for the LifetimeStatsPage analytics surface (A7) — the seam that attaches real screen content to
// the `lifetimeStats` ⁄ `/lifetime-stats` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [LifetimeStatsRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Analytics +
// Settings holders + the app-scoped active-vehicle selection via [lifetimeStatsPageSourceOf], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.lifetimestats

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `lifetimeStats` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Analytics + Settings holders + the active
 * vehicle selection, and binds the page to the app's redacting logger.
 */
@Composable
fun LifetimeStatsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            lifetimeStatsPageSourceOf(
                analyticsStore = container.analyticsStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    LifetimeStatsPage(source = source, logger = container.logger)
}

/**
 * Registers the [LifetimeStatsRoute] host for the `lifetimeStats` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object LifetimeStatsPageHost {
    private val id: String = LifetimeStatsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { LifetimeStatsRoute() }
    }
}
