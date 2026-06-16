// Page-host wiring for the SleepEfficiencyPage surface (A7) — the seam that attaches real screen content to the
// `sleepEfficiency` ⁄ `/sleep-efficiency` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.battery.batteryhealth.BatteryHealthPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [SleepEfficiencyRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Settings holder + the app-scoped active-vehicle selection (and a page-local sleep repository over the shared client +
// cache) via [sleepEfficiencyPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.battery.sleepefficiency

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `sleepEfficiency` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the page-local sleep repository (constructed from the shared client +
 * offline cache the container exposes) + the shared Settings holder + the active-vehicle selection, and binds the page
 * to the app's redacting logger.
 */
@Composable
fun SleepEfficiencyRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            sleepEfficiencyPageSourceOf(
                extras = SleepExtrasRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    SleepEfficiencyPage(source = source, logger = container.logger)
}

/**
 * Registers the [SleepEfficiencyRoute] host for the `sleepEfficiency` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SleepEfficiencyPageHost {
    private val id: String = SleepEfficiencyPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SleepEfficiencyRoute() }
    }
}
