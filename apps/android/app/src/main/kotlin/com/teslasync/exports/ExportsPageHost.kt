// Page-host wiring for the ExportsPage surface (A7) — the seam that attaches real screen content to the
// `exports` ⁄ `/exports` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.driveslist.DrivesListPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [ExportsRoute] reads the app DI graph from [LocalDataContainer], binds the page to a
// page-local exports repository (constructed over the shared resilient client + offline cache the container
// already exposes, since the Android DI graph wires no ExportsStore yet) via [exportsPageSourceOf], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/exports) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.exports.exports

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpExportsRepository

/**
 * The stateful route entry registered for the `exports` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local exports repository (constructed from the shared client +
 * offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun ExportsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            exportsPageSourceOf(
                exportsRepository = HttpExportsRepository(container.api, container.cacheStore),
            )
        }
    ExportsPage(source = source, logger = container.logger)
}

/**
 * Registers the [ExportsRoute] host for the `exports` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ExportsPageHost {
    private val id: String = ExportsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ExportsRoute() }
    }
}
