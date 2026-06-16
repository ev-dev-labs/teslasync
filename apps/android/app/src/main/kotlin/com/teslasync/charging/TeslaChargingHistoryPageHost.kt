// Page-host wiring for the TeslaChargingHistoryPage charging surface (A7) — the seam that attaches real screen
// content to the `teslaChargingHistory` ⁄ `/tesla-charging-history` navigation destination (Destinations.kt L61).
// It mirrors the sibling [io.teslasync.android.charging.chargingcurve.ChargingCurvePageHost] precedent: [register]
// is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls
// through to the shared not-found screen. [TeslaChargingHistoryRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared S8 Vehicles + Settings stores and a page-local charging
// repository (constructed over the shared resilient client + offline cache the container already exposes, since
// the Android DI graph wires no ChargingStore yet) via [teslaChargingHistoryPageSourceOf], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.teslacharginghistory

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpChargingRepository

/**
 * The stateful route entry registered for the `teslaChargingHistory` destination. Resolves the app data graph
 * from the CompositionLocal, builds the source over the shared Vehicles + Settings stores + a page-local charging
 * repository (constructed from the shared client + offline cache the container exposes), and binds the page to
 * the app's redacting logger.
 */
@Composable
fun TeslaChargingHistoryRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            teslaChargingHistoryPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                chargingRepository = HttpChargingRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
            )
        }
    TeslaChargingHistoryPage(source = source, logger = container.logger)
}

/**
 * Registers the [TeslaChargingHistoryRoute] host for the `teslaChargingHistory` route. Called once at process
 * start; idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TeslaChargingHistoryPageHost {
    private val id: String = TeslaChargingHistoryPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TeslaChargingHistoryRoute() }
    }
}
