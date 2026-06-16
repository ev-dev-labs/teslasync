// Page-host wiring for the DriveScorePage driving surface (A7) — the seam that attaches real screen content to the
// `driveScore` ⁄ `/drive-score` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.analytics.statistics.StatisticsPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [DriveScoreRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Settings holder +
// the app-scoped active-vehicle selection + a page-constructed [HttpDrivingRepository] (the shared S7 Driving
// repository, built over the SAME resilient client + offline cache the container exposes) via [driveScorePageSourceOf],
// and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.drivescore

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpDrivingRepository

/**
 * The stateful route entry registered for the `driveScore` destination. Resolves the app data graph from the
 * CompositionLocal, constructs the shared S7 [HttpDrivingRepository] over the container's resilient client + offline
 * cache, binds the page to it + the shared Settings holder + the active-vehicle selection, and hands the page the app's
 * redacting logger.
 */
@Composable
fun DriveScoreRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            driveScorePageSourceOf(
                driving = HttpDrivingRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    DriveScorePage(source = source, logger = container.logger)
}

/**
 * Registers the [DriveScoreRoute] host for the `driveScore` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DriveScorePageHost {
    private val id: String = DriveScorePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DriveScoreRoute() }
    }
}
