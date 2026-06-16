// Page-host wiring for the RedisSignalViewerPage admin surface (A7) — the seam that attaches real screen content
// to the `redisSignals` ⁄ `/redis-signals` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [RedisSignalViewerRoute] reads the shared S8 Vehicles holder + the app logger from
// [LocalDataContainer] and the single resilient API client from the process [AuthContainer]
// ([io.teslasync.android.TeslaSyncApplication.container]) — the redis dev-tools endpoints have no shared-core
// store, so the page binds them over that one client (the breaker/retry/401-refresh stay centralised). It
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.redissignals

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.TeslaSyncApplication
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `redisSignals` destination. Resolves the shared Vehicles holder +
 * logger from the CompositionLocal and the single resilient client from the process [TeslaSyncApplication], builds
 * the source over both, and binds the page. The same client the rest of the app uses (so the redis dev-tools
 * calls carry the bearer + 401 refresh + circuit breaker).
 */
@Composable
fun RedisSignalViewerRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val api =
        remember(context) {
            (context.applicationContext as TeslaSyncApplication).container.apiHttpClient
        }
    val source =
        remember(container, api) {
            redisSignalViewerSource(vehiclesStore = container.vehiclesStore, api = api)
        }
    RedisSignalViewerPage(source = source, logger = container.logger)
}

/**
 * Registers the [RedisSignalViewerRoute] host for the `redisSignals` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object RedisSignalViewerPageHost {
    private val id: String = RedisSignalViewerPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { RedisSignalViewerRoute() }
    }
}
