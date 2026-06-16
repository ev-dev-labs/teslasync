// Page-host wiring for the NotFoundPage surface (A7) — the seam that attaches real screen content to the pre-existing
// `notFound` ⁄ `/not-found` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.roadmap.RoadmapPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [NotFoundRoute] reads the app DI graph from [LocalDataContainer] only to bind the page to the app's redacting
// logger — the page reads no API (the web page renders from navigation/local state), so there is no store or
// repository to wire, and it performs no HTTP itself.
//
// Attempted path: the web page reads `location.pathname` to name the unmatched URL + rank suggestions. The host reads
// the same from the back-stack entry's optional `path` argument when a caller threads one (e.g. a future deep-link
// integration); absent that, the framework-free model falls back to the canonical not-found path. The closest-route
// suggestion engine is fully wired either way.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.notfound

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `notFound` destination. Resolves the app data graph from the
 * CompositionLocal solely to bind the page to the app's redacting logger; the static 404 surface needs no shared store
 * or repository. [attemptedPath] is the unmatched URL (web `location.pathname`), threaded from the nav entry when
 * available.
 */
@Composable
fun NotFoundRoute(attemptedPath: String? = null) {
    val container = LocalDataContainer.current
    NotFoundPage(attemptedPath = attemptedPath, logger = container.logger)
}

/**
 * Registers the [NotFoundRoute] host for the `notFound` route, upgrading it from the shared bare not-found screen to
 * the full web-parity surface. Called once at process start; idempotent so a repeat call (e.g. after a per-app
 * language change re-localizes the surface) is a no-op.
 */
object NotFoundPageHost {
    private val id: String = NotFoundPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry ->
            NotFoundRoute(attemptedPath = entry.arguments?.getString(NotFoundPageRegistration.ARG_PATH))
        }
    }
}
