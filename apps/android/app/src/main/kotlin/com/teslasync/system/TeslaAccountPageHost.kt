// Page-host wiring for the TeslaAccountPage surface (A7) — the seam that attaches real screen content to the
// `teslaAccount` ⁄ `/tesla-account` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.admin.region.TeslaRegionPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [TeslaAccountRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared
// User/Account holder (web `useUser` port) the data graph exposes, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.teslaaccount

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `teslaAccount` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared
 * [io.teslasync.shared.core.presentation.user.UserStore], and binds the page to the app's redacting logger. The
 * cache-then-network profile feed + its Refresh mutation live in the bound view-model; this route owns no data
 * of its own.
 */
@Composable
fun TeslaAccountRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { teslaAccountPageSourceOf(container.userStore) }
    TeslaAccountPage(source = source, logger = container.logger)
}

/**
 * Registers the [TeslaAccountRoute] host for the `teslaAccount` route. Called once at process start; idempotent
 * so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TeslaAccountPageHost {
    private val id: String = TeslaAccountPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TeslaAccountRoute() }
    }
}
