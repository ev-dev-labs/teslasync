// Page-host wiring for the StatusApiDocsPage surface (A7) — the seam that attaches real screen content to the
// `statusApiDocs` ⁄ `/docs/status-api` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.roadmap.RoadmapPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [StatusApiDocsRoute] reads the app DI graph from [LocalDataContainer] only to bind the page to the app's redacting
// logger — the page reads no API (the web page renders a static contract), so there is no store or repository to
// wire, and it performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.statusapidocs

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `statusApiDocs` destination. Resolves the app data graph from the
 * CompositionLocal solely to bind the page to the app's redacting logger; the static contract docs need no shared
 * store or repository.
 */
@Composable
fun StatusApiDocsRoute() {
    val container = LocalDataContainer.current
    StatusApiDocsPage(logger = container.logger)
}

/**
 * Registers the [StatusApiDocsRoute] host for the `statusApiDocs` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object StatusApiDocsPageHost {
    private val id: String = StatusApiDocsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { StatusApiDocsRoute() }
    }
}
