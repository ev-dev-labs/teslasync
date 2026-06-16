// Page-host wiring for the DigitalTwinPage vehicles surface (A7) — the seam that attaches real screen content to the
// `digitalTwin` ⁄ `/digital-twin` navigation destination (Destinations.kt L55). It mirrors the sibling
// [io.teslasync.android.vehiclesystems.mediaplayer.MediaPlayerPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [DigitalTwinRoute] resolves the app DI graph from [LocalDataContainer], binds the page to the shared
// resilient client + the app-scoped active-vehicle selection via [digitalTwinPageSourceOf], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.digitaltwin

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `digitalTwin` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared resilient client + the app-scoped active-vehicle selection, and
 * binds the page to the app's redacting logger.
 */
@Composable
fun DigitalTwinRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            digitalTwinPageSourceOf(
                api = container.api,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    DigitalTwinPage(source = source, logger = container.logger)
}

/**
 * Registers the [DigitalTwinRoute] host for the `digitalTwin` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DigitalTwinPageHost {
    private val id: String = DigitalTwinPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DigitalTwinRoute() }
    }
}
