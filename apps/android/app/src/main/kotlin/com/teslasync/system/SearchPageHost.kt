// Page-host wiring for the SearchPage surface (A7) — the seam that attaches real screen content to the
// `search` ⁄ `/search` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.commands.CommandsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [SearchRoute] reads the app DI graph from [LocalDataContainer] and constructs a page-local
// [io.teslasync.shared.core.data.repo.HttpSearchRepository] over the shared resilient client + offline cache the
// container exposes (the Android DI graph wires no SearchStore yet, exactly as the Commands surface documents for
// its page-local repository), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.search

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSearchRepository

/**
 * The stateful route entry registered for the `search` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local [HttpSearchRepository] (constructed from the shared client +
 * offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun SearchRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            searchPageSourceOf(
                searchRepository = HttpSearchRepository(container.api, container.cacheStore),
            )
        }
    SearchPage(source = source, logger = container.logger)
}

/**
 * Registers the [SearchRoute] host for the `search` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SearchPageHost {
    private val id: String = SearchPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SearchRoute() }
    }
}
