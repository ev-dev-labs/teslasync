// Page-host wiring for the AnomalyDashboardPage diagnostics surface (A7) — the seam that attaches real screen content
// to the `anomalyDetection` ⁄ `/anomaly-detection` navigation destination (Destinations.kt). It mirrors the sibling
// A7 analytics precedents (e.g. [io.teslasync.android.analytics.statistics.StatisticsPageHost]): [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [AnomalyDashboardRoute] reads the app DI graph from [LocalDataContainer], binds the page to
// the shared-core anomalies repository (constructed over the shared resilient client + offline cache the container
// exposes) + the app-scoped active-vehicle selection via [anomalyDashboardPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.diagnostics.anomalydashboard

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpAnomaliesRepository

/**
 * The stateful route entry registered for the `anomalyDetection` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared-core [HttpAnomaliesRepository] (constructed from the shared
 * client + offline cache the container exposes) + the active-vehicle selection, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun AnomalyDashboardRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            anomalyDashboardPageSourceOf(
                repository = HttpAnomaliesRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    AnomalyDashboardPage(source = source, logger = container.logger)
}

/**
 * Registers the [AnomalyDashboardRoute] host for the `anomalyDetection` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AnomalyDashboardPageHost {
    private val id: String = AnomalyDashboardPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AnomalyDashboardRoute() }
    }
}
