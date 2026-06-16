// Page-host wiring for the FleetTelemetryCoveragePage admin surface (A7) — the seam that attaches real screen
// content to the `adminTelemetryCoverage` ⁄ `/admin/telemetry/coverage` navigation destination
// (Destinations.kt). It mirrors the [io.teslasync.android.admin.apilogs.ApiLogsPageHost] /
// [io.teslasync.android.admin.feedback.FeedbackQueuePageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [FleetTelemetryCoverageRoute] reads the app DI graph from [LocalDataContainer], binds the
// page to the shared S8 [io.teslasync.shared.core.presentation.fleettelemetry.FleetTelemetryStore] via
// [asFleetTelemetryCoverageSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.fleettelemetry

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminTelemetryCoverage` destination. Resolves the app data
 * graph from the CompositionLocal, builds the source over the shared S8 Fleet-Telemetry holder, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun FleetTelemetryCoverageRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.fleetTelemetryStore.asFleetTelemetryCoverageSource() }
    FleetTelemetryCoveragePage(source = source, logger = container.logger)
}

/**
 * Registers the [FleetTelemetryCoverageRoute] host for the `adminTelemetryCoverage` route. Called once at
 * process start; idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface)
 * is a no-op.
 */
object FleetTelemetryCoveragePageHost {
    private val id: String = FleetTelemetryCoverageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { FleetTelemetryCoverageRoute() }
    }
}
