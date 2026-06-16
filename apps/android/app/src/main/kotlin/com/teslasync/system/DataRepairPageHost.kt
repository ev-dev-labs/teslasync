// Page-host wiring for the DataRepairPage system surface (A7) — the seam that attaches real screen content to the
// `dataRepair` ⁄ `/data-repair` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.maps.geofences.GeofencesPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [DataRepairRoute] reads the app DI graph from [LocalDataContainer], binds the page to the data-repair
// source over the shared resilient client the container exposes via [dataRepairPageSourceOf], and performs no
// HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.datarepair

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `dataRepair` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared resilient client the container exposes, and binds the page
 * to the app's redacting logger.
 */
@Composable
fun DataRepairRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { dataRepairPageSourceOf(container.api) }
    DataRepairPage(source = source, logger = container.logger)
}

/**
 * Registers the [DataRepairRoute] host for the `dataRepair` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DataRepairPageHost {
    private val id: String = DataRepairPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DataRepairRoute() }
    }
}
