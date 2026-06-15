// Page-host wiring for the BatteryHealthPage surface (A7) — the seam that attaches real screen content to the
// `batteryHealth` ⁄ `/battery` navigation destination (Destinations.kt L79). It mirrors the sibling
// [io.teslasync.android.analytics.statistics.StatisticsPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [BatteryHealthRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Energy +
// Settings holders + the app-scoped active-vehicle selection (and a page-local charging repository over the shared
// client + cache) via [batteryHealthPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.batteryhealth

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `batteryHealth` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Energy/Settings holders + the active-vehicle selection + a
 * page-local charging repository (constructed from the shared client + offline cache the container exposes), and binds
 * the page to the app's redacting logger.
 */
@Composable
fun BatteryHealthRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            batteryHealthPageSourceOf(
                extras = BatteryExtrasRepository(container.api, container.cacheStore),
                energyStore = container.energyStore,
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    BatteryHealthPage(source = source, logger = container.logger)
}

/**
 * Registers the [BatteryHealthRoute] host for the `batteryHealth` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object BatteryHealthPageHost {
    private val id: String = BatteryHealthPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { BatteryHealthRoute() }
    }
}
