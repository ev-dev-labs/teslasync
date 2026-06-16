// Page-host wiring for the SecurityAccessPage admin surface (A7) — the seam that attaches real screen content to
// the `securityAccess` ⁄ `/security-access` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [SecurityAccessRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// Vehicles + Admin holders via [securityAccessSourceOf] and the app-wide selection holder, and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.securityaccess

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `securityAccess` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Admin holders, and binds the
 * page to the app-wide selection holder + the app's redacting logger.
 */
@Composable
fun SecurityAccessRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            securityAccessSourceOf(
                vehiclesStore = container.vehiclesStore,
                adminStore = container.adminStore,
            )
        }
    SecurityAccessPage(
        source = source,
        selection = container.selectedVehicleStore,
        logger = container.logger,
    )
}

/**
 * Registers the [SecurityAccessRoute] host for the `securityAccess` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SecurityAccessPageHost {
    private val id: String = SecurityAccessRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SecurityAccessRoute() }
    }
}
