// Page-host wiring for the TripDetailPage trips surface (A7) — the seam that attaches real screen content to the
// `tripDetail` ⁄ `/trips/:id` navigation destination (Destinations.kt). It mirrors the sibling parameterized-route
// precedents (YearReviewPageHost / SharedDrivePageHost): [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [TripDetailRoute] reads the trip id from the route argument (web `useParams().id`), resolves the app DI graph
// from [LocalDataContainer], binds the page to the shared settings holder + a page-local trips repository
// (constructed over the shared resilient client + offline cache the container exposes, since the Android DI graph
// wires no TripsStore yet) via [tripDetailPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.trips.tripdetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTripsRepository

/**
 * The stateful route entry registered for the `tripDetail` destination. Reads the trip [TripDetailPageRegistration.ARG_ID]
 * argument from the route (web `useParams().id`), resolves the app data graph from the CompositionLocal, builds the
 * source over the shared settings holder + a page-local trips repository (constructed from the shared client +
 * offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun TripDetailRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            tripDetailPageSourceOf(
                tripsRepository = HttpTripsRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
            )
        }
    val id =
        remember(entry) {
            entry.arguments?.getString(TripDetailPageRegistration.ARG_ID).orEmpty()
        }
    TripDetailPage(source = source, id = id, logger = container.logger)
}

/**
 * Registers the [TripDetailRoute] host for the `tripDetail` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TripDetailPageHost {
    private val id: String = TripDetailPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> TripDetailRoute(entry) }
    }
}
