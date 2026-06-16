// Page-host wiring for the TeslaOrdersPage admin surface (A7) — the seam that attaches real screen content
// to the `teslaOrders` ⁄ `/tesla-orders` navigation destination (Destinations.kt). It mirrors the
// [GasPriceAutoPollPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [TeslaOrdersRoute] reads the app DI graph from [LocalDataContainer], binds the embedded
// ActiveOrdersSection feature view to the shared S8 [io.teslasync.android.data.DataContainer.userStore], and
// performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.teslaorders

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `teslaOrders` destination. Resolves the app data graph from the
 * CompositionLocal and binds the page to the shared User/Account state holder + the app's redacting logger.
 */
@Composable
fun TeslaOrdersRoute() {
    val container = LocalDataContainer.current
    TeslaOrdersPage(store = container.userStore, logger = container.logger)
}

/**
 * Registers the [TeslaOrdersRoute] host for the `teslaOrders` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TeslaOrdersPageHost {
    private val id: String = TeslaOrdersPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TeslaOrdersRoute() }
    }
}
