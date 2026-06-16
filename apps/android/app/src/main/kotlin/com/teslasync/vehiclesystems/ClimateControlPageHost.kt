// Page-host wiring for the ClimateControlPage vehicle-systems surface (A7) — the seam that attaches real screen
// content to the `climateControl` ⁄ `/climate-control` navigation destination (Destinations.kt). It mirrors the
// sibling [io.teslasync.android.maps.temperatureimpact.TemperatureImpactPageHost] precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [ClimateControlRoute] reads the app DI graph from [LocalDataContainer], binds the page to
// the shared resilient client, the app-scoped active-vehicle selection and the shared settings holder via
// [climateControlPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.climatecontrol

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `climateControl` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared resilient client, the app-scoped active-vehicle selection and
 * the shared settings holder, and binds the page to the app's redacting logger.
 */
@Composable
fun ClimateControlRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            climateControlPageSourceOf(
                api = container.api,
                selectedVehicleStore = container.selectedVehicleStore,
                settingsStore = container.settingsStore,
            )
        }
    ClimateControlPage(source = source, logger = container.logger)
}

/**
 * Registers the [ClimateControlRoute] host for the `climateControl` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ClimateControlPageHost {
    private val id: String = ClimateControlPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ClimateControlRoute() }
    }
}
