// Page-host wiring for the DataExportPage system surface (A7) — the seam that attaches real screen content to
// the `dataExport` ⁄ `/data-export` navigation destination (Destinations.kt). It mirrors the sibling A7
// precedent (ApiLogsPageHost): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [DataExportRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// ExportsStore + VehiclesStore via [bindDataExportSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.dataexport

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `dataExport` destination. Resolves the app data graph from the
 * CompositionLocal, builds the data seam over the shared Exports + Vehicles holders, and binds the page to the
 * app's redacting logger.
 */
@Composable
fun DataExportRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { bindDataExportSource(container.exportsStore, container.vehiclesStore) }
    DataExportPage(source = source, logger = container.logger)
}

/**
 * Registers the [DataExportRoute] host for the `dataExport` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DataExportPageHost {
    private val id: String = DataExportPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DataExportRoute() }
    }
}
