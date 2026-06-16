// Page-host wiring for the ChargingHeatmapPage charging surface (A7) — the seam that attaches real screen content to the
// `chargingHeatmap` ⁄ `/charging-heatmap` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.battery.batteryhealth.BatteryHealthPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [ChargingHeatmapRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S7
// Charging repository (built from the primitives the DataContainer already exposes — the resilient [ApiHttpClient] +
// offline [CacheStore], exactly as the DataContainer builds its own repositories) plus the shared Settings + active
// vehicle holders, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.chargingheatmap

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpChargingRepository

/**
 * The stateful route entry registered for the `chargingHeatmap` destination. Resolves the app data graph from the
 * CompositionLocal, builds the shared-core charging repository + the page source over the shared Settings + active
 * vehicle holders, and binds the page to the app's redacting logger.
 */
@Composable
fun ChargingHeatmapRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            chargingHeatmapPageSourceOf(
                charging = HttpChargingRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    ChargingHeatmapPage(source = source, logger = container.logger)
}

/**
 * Registers the [ChargingHeatmapRoute] host for the `chargingHeatmap` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ChargingHeatmapPageHost {
    private val id: String = ChargingHeatmapPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ChargingHeatmapRoute() }
    }
}
