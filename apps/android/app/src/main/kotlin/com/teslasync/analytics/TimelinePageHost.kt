// Page-host wiring for the TimelinePage analytics surface (A7) — the seam that attaches real screen content to the
// `timeline` ⁄ `/timeline` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.analytics.lifetimestats.LifetimeStatsPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [TimelineRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Vehicles + Analytics holders + the app-scoped active-vehicle selection via [timelinePageSourceOf], and performs no
// HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.timeline

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `timeline` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Analytics holders + the active
 * vehicle selection, and binds the page to the app's redacting logger.
 */
@Composable
fun TimelineRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            timelinePageSourceOf(
                vehiclesStore = container.vehiclesStore,
                analyticsStore = container.analyticsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    TimelinePage(source = source, logger = container.logger)
}

/**
 * Registers the [TimelineRoute] host for the `timeline` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TimelinePageHost {
    private val id: String = TimelinePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TimelineRoute() }
    }
}
