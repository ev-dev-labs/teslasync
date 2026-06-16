// Page-host wiring for the analytics MileagePage surface (A7) — the seam that attaches real screen content
// to the `mileage` ⁄ `/mileage` navigation destination (Destinations.kt). It mirrors the [ApiLogsPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication];
// until then the route falls through to the shared not-found screen. [MileageRoute] reads the app DI graph
// from [LocalDataContainer], binds the page to the shared S8 Vehicles + Analytics holders via
// [mileageSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName`
// is suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.analytics.mileage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `mileage` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Analytics holders, and
 * binds the page to the app-scoped vehicle selection + redacting logger.
 */
@Composable
fun MileageRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { mileageSource(container.vehiclesStore, container.analyticsStore) }
    MileagePage(source = source, selection = container.selectedVehicleStore, logger = container.logger)
}

/**
 * Registers the [MileageRoute] host for the `mileage` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object MileagePageHost {
    private val id: String = MileagePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { MileageRoute() }
    }
}
