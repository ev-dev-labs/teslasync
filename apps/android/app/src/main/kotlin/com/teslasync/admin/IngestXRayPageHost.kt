// Page-host wiring for the IngestXRayPage admin surface (A7) — the seam that attaches real screen content to the
// `adminIngestXray` ⁄ `/admin/ingest-xray` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.apilogs.ApiLogsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [IngestXRayRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Vehicles +
// Ingest-X-Ray holders via [ingestXRaySourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.ingestxray

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminIngestXray` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Ingest-X-Ray holders, and
 * binds the page to the app's redacting logger.
 */
@Composable
fun IngestXRayRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            ingestXRaySourceOf(
                vehiclesStore = container.vehiclesStore,
                ingestXRayStore = container.ingestXRayStore,
            )
        }
    IngestXRayPage(source = source, logger = container.logger)
}

/**
 * Registers the [IngestXRayRoute] host for the `adminIngestXray` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object IngestXRayPageHost {
    private val id: String = IngestXRayPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { IngestXRayRoute() }
    }
}
