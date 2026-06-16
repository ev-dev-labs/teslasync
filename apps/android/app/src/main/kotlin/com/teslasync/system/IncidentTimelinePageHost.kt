// Page-host wiring for the IncidentTimelinePage surface (A7) — the seam that attaches real screen content to the
// `incidentTimeline` ⁄ `/system-status/incidents/:id` navigation destination (Destinations.kt). It mirrors the
// sibling [io.teslasync.android.sharing.shareddrive.SharedDrivePageHost] precedent for a parameterized route:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route
// falls through to the shared not-found screen. [IncidentTimelineRoute] reads the incident id from the route
// argument (web `useParams().id`), resolves the app DI graph from [LocalDataContainer], binds the page to a
// page-local [io.teslasync.shared.core.data.repo.HttpIncidentRepository] constructed over the shared resilient
// client + offline cache the container exposes (the Android DI graph wires no IncidentsStore yet, exactly as the
// sibling CommandsRoute builds its own HttpCommandsRepository), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.incidenttimeline

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpIncidentRepository

/**
 * The stateful route entry registered for the `incidentTimeline` destination. Reads the incident id from the route
 * argument (web `useParams().id`), resolves the app data graph from the CompositionLocal, builds the source over a
 * page-local incident repository (constructed from the shared client + offline cache the container exposes), and
 * binds the page to the app's redacting logger.
 */
@Composable
fun IncidentTimelineRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            incidentTimelinePageSourceOf(HttpIncidentRepository(container.api, container.cacheStore))
        }
    val rawId =
        remember(entry) {
            entry.arguments?.getString(IncidentTimelinePageRegistration.ARG_ID).orEmpty()
        }
    IncidentTimelinePage(source = source, rawId = rawId, logger = container.logger)
}

/**
 * Registers the [IncidentTimelineRoute] host for the `incidentTimeline` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object IncidentTimelinePageHost {
    private val id: String = IncidentTimelinePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> IncidentTimelineRoute(entry) }
    }
}
