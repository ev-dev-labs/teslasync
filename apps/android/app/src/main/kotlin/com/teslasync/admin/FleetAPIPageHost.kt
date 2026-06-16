// Page-host wiring for the FleetAPIPage admin surface (A7) — the seam that attaches real screen content to the
// `fleetApi` ⁄ `/fleet-api` navigation destination (Destinations.kt). It mirrors the [ApiLogsPageHost] /
// [FeedbackQueuePageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [FleetApiRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.settings.SettingsStore] via [asFleetApiSource], and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.fleetapi

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `fleetApi` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared Settings holder, and binds the page to the app's
 * redacting logger.
 */
@Composable
fun FleetApiRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.settingsStore.asFleetApiSource() }
    FleetAPIPage(source = source, logger = container.logger)
}

/**
 * Registers the [FleetApiRoute] host for the `fleetApi` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object FleetAPIPageHost {
    private val id: String = FleetApiRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { FleetApiRoute() }
    }
}
