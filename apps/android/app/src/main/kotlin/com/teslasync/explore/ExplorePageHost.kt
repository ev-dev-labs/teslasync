// Page-host wiring for the ExplorePage surface (A7) — the seam that attaches real screen content to the
// `explore` ⁄ `/explore` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.dashboard.glance.GlancePageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [ExploreRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared Vehicles holder,
// constructs a page-local [io.teslasync.shared.core.presentation.authmode.AuthModeStore] over the shared resilient
// client + offline cache the container exposes (the Android DI graph wires no app-wide AuthModeStore into the
// DataContainer yet, exactly as the GlancePageHost constructs its own page-local VehicleCommandStore), and wires
// the on-device recent-pages store the recently-visited strip resolves against the catalog. It performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.explore

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.recentlyviewed.SharedPreferencesRecentPagesStore
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpAuthModeRepository
import io.teslasync.shared.core.presentation.authmode.AuthModeStore

/**
 * The stateful route entry registered for the `explore` destination. Resolves the app data graph from the
 * CompositionLocal, binds the page to the shared [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 * (web `useVehicles`) + a page-local [AuthModeStore] (web `useIsForwardAuth`, constructed from the shared client +
 * offline cache) + the on-device recent-pages store (web `getRecentPages`), and binds the page to the app's
 * redacting logger.
 */
@Composable
fun ExploreRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val source =
        remember(container, context, scope) {
            explorePageSourceOf(
                vehiclesStore = container.vehiclesStore,
                authModeStore = AuthModeStore(HttpAuthModeRepository(container.api, container.cacheStore), scope),
                recentPagesStore = SharedPreferencesRecentPagesStore(context),
            )
        }
    ExplorePage(source = source, logger = container.logger)
}

/**
 * Registers the [ExploreRoute] host for the `explore` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ExplorePageHost {
    private val id: String = ExplorePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ExploreRoute() }
    }
}
