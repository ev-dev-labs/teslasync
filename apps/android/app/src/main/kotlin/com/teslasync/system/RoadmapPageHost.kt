// Page-host wiring for the RoadmapPage surface (A7) — the seam that attaches real screen content to the
// `roadmap` ⁄ `/roadmap` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.commands.CommandsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [RoadmapRoute] reads the app DI graph from [LocalDataContainer] only to bind the page to the app's redacting
// logger — the page reads no API (the web page renders a static catalog), so there is no store or repository to
// wire, and it performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.roadmap

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `roadmap` destination. Resolves the app data graph from the
 * CompositionLocal solely to bind the page to the app's redacting logger; the static roadmap catalog needs no
 * shared store or repository.
 */
@Composable
fun RoadmapRoute() {
    val container = LocalDataContainer.current
    RoadmapPage(logger = container.logger)
}

/**
 * Registers the [RoadmapRoute] host for the `roadmap` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object RoadmapPageHost {
    private val id: String = RoadmapPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { RoadmapRoute() }
    }
}
