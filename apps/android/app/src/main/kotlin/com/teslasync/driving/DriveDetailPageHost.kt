// Page-host wiring for the DriveDetailPage driving surface (A7) — the seam that attaches real screen content to
// the `driveDetail` ⁄ `/drives/:id` navigation destination (Destinations.kt L68). It mirrors the
// [io.teslasync.android.analytics.yearreview.YearReviewPageHost] parameterized precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [DriveDetailRoute] reads the drive id from the route argument (web `useParams().id`),
// resolves the app DI graph from [LocalDataContainer], builds the source over a page-local drive repository + the
// shared Vehicles holder + the live unit formatter via [driveDetailPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.drivedetail

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `driveDetail` destination. Reads the drive [id] from the route
 * argument (web `useParams().id`; a missing / non-numeric value resolves to a hard error surface), resolves the
 * app data graph from the CompositionLocal, builds the source over a page-local [DriveDetailRepository] (over the
 * shared client + offline cache the container exposes) + the shared Vehicles holder + the live unit formatter,
 * and binds the page to the app's redacting logger.
 */
@Composable
fun DriveDetailRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            driveDetailPageSourceOf(
                driveRepository = DriveDetailRepository(container.api, container.cacheStore),
                vehiclesStore = container.vehiclesStore,
                unitFormatter = container.unitFormatter,
            )
        }
    val driveId =
        remember(entry) {
            entry.arguments?.getString(DriveDetailPageRegistration.ARG_ID)?.toLongOrNull()
        }
    DriveDetailPage(source = source, driveId = driveId, logger = container.logger)
}

/**
 * Registers the [DriveDetailRoute] host for the `driveDetail` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DriveDetailPageHost {
    private val id: String = DriveDetailPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { entry -> DriveDetailRoute(entry) }
    }
}
