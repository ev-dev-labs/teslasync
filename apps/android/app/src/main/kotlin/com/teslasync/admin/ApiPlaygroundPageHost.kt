// Page-host wiring for the ApiPlaygroundPage admin surface (A7) — the seam that attaches real screen content to the
// `apiPlayground` ⁄ `/api-playground` navigation destination (Destinations.kt, already a metadata-only route). It
// mirrors the sibling [io.teslasync.android.admin.region.TeslaRegionPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [ApiPlaygroundRoute] renders the page directly — the page resolves the app data graph (the shared
// resilient `ApiHttpClient`) from [LocalDataContainer] itself and performs no HTTP in the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.apiplayground

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `apiPlayground` destination. Binds the page to the app's redacting
 * logger (for the one-shot `view.opened` diagnostic); the page builds its own source over the shared client exposed
 * by the data graph, so this route resolves no data graph beyond the logger.
 */
@Composable
fun ApiPlaygroundRoute() {
    ApiPlaygroundPage(logger = LocalDataContainer.current.logger)
}

/**
 * Registers the [ApiPlaygroundRoute] host for the `apiPlayground` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ApiPlaygroundPageHost {
    private val id: String = ApiPlaygroundPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ApiPlaygroundRoute() }
    }
}
