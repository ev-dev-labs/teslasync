// Page-host wiring for the VehicleDetailPage vehicles surface (A7) — the seam that attaches real screen content to the
// `vehicleDetail` ⁄ `/vehicles/:id` navigation destination (Destinations.kt L53). It mirrors the sibling
// [io.teslasync.android.sharing.shareddrive.SharedDrivePageHost] precedent for a parameterized route: [register] is
// called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to
// the shared not-found screen. [VehicleDetailRoute] reads the numeric vehicle id from the route argument (web
// `useParams().id`), resolves the app DI graph from [LocalDataContainer], binds the page to the shared resilient client
// + the shared settings holder via [vehicleDetailPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.vehicledetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `vehicleDetail` destination. Reads the numeric vehicle [id] from the
 * route argument (web `useParams().id`), resolves the app data graph from the CompositionLocal, builds the source over
 * the shared resilient client + the shared settings holder, and binds the page to the app's redacting logger. A
 * non-numeric / missing argument resolves to id 0 (the view-model then surfaces the empty/error state rather than
 * issuing a malformed request).
 */
@Composable
fun VehicleDetailRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            vehicleDetailPageSourceOf(
                api = container.api,
                settingsStore = container.settingsStore,
            )
        }
    val vehicleId =
        remember(entry) {
            entry.arguments?.getString(VehicleDetailPageRegistration.ARG_ID)?.toLongOrNull() ?: 0L
        }
    VehicleDetailPage(source = source, vehicleId = vehicleId, logger = container.logger)
}

/**
 * Registers the [VehicleDetailRoute] host for the `vehicleDetail` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object VehicleDetailPageHost {
    private val id: String = VehicleDetailPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> VehicleDetailRoute(entry) }
    }
}
