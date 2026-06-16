// Page-host wiring for the BatteryDegradationPage surface (A7) — the seam that attaches real screen content to the
// `batteryDegradation` ⁄ `/battery-degradation` navigation destination (Destinations.kt). It mirrors the sibling
// analytics-page precedent (StatisticsPageHost): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [BatteryDegradationRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Energy + Settings holders + the app-scoped active-vehicle selection via [batteryDegradationPageSourceOf], and
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.degradation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `batteryDegradation` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over the shared Energy/Settings holders + the active-vehicle selection,
 * and binds the page to the app's redacting logger.
 */
@Composable
fun BatteryDegradationRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            batteryDegradationPageSourceOf(
                energyStore = container.energyStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    BatteryDegradationPage(source = source, logger = container.logger)
}

/**
 * Registers the [BatteryDegradationRoute] host for the `batteryDegradation` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object BatteryDegradationPageHost {
    private val id: String = BatteryDegradationPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { BatteryDegradationRoute() }
    }
}
