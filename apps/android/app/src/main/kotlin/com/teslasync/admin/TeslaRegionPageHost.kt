// Page-host wiring for the TeslaRegionPage admin surface (A7) — the seam that attaches real screen content
// to the `teslaRegion` ⁄ `/tesla-region` navigation destination (Destinations.kt). It mirrors the
// [GasPriceAutoPollPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [TeslaRegionRoute] reads the app DI graph from [LocalDataContainer], binds the embedded
// RegionSettings feature view to the shared S8 [io.teslasync.shared.core.presentation.user.UserStore] exposed
// by the data graph, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.region

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `teslaRegion` destination. Resolves the app data graph from the
 * CompositionLocal and binds the page to the shared User/Account state holder (web `useUser` port) and the
 * app's redacting logger. The cache-then-network region feed + its Refresh mutation live entirely in the
 * embedded RegionSettings feature view; this route owns no data of its own.
 */
@Composable
fun TeslaRegionRoute() {
    val container = LocalDataContainer.current
    TeslaRegionPage(store = container.userStore, logger = container.logger)
}

/**
 * Registers the [TeslaRegionRoute] host for the `teslaRegion` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TeslaRegionPageHost {
    private val id: String = TeslaRegionPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TeslaRegionRoute() }
    }
}
