// Page-host wiring for the TripReplayPage surface (A7) — the seam that attaches real screen content to the `tripReplay`
// ⁄ `/drives/:id/replay` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.driving.regenefficiency.RegenEfficiencyPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [TripReplayRoute] reads the app DI graph from [LocalDataContainer], reads the `{id}` drive argument from the
// [NavBackStackEntry], binds the page to a page-local driving repository (constructed over the shared resilient client +
// offline cache the container already exposes, since the Android DI graph wires no DrivingStore yet) + the shared
// settings holder via [tripReplayPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.driving.tripreplay

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.navigation.NavBackStackEntry
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpDrivingRepository

/**
 * The stateful route entry registered for the `tripReplay` destination. Resolves the app data graph from the
 * CompositionLocal, reads the `{id}` drive argument from [entry], builds the source over a page-local driving repository
 * (constructed from the shared client + offline cache the container exposes) + the shared settings holder, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun TripReplayRoute(entry: NavBackStackEntry) {
    val container = LocalDataContainer.current
    val driveId =
        remember(entry) {
            entry.arguments?.getString(TripReplayPageRegistration.ARG_ID).orEmpty()
        }
    val source =
        remember(container) {
            tripReplayPageSourceOf(
                drivingRepository = HttpDrivingRepository(container.api, container.cacheStore),
                settingsStore = container.settingsStore,
            )
        }
    TripReplayPage(source = source, driveId = driveId, logger = container.logger)
}

/**
 * Registers the [TripReplayRoute] host for the `tripReplay` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object TripReplayPageHost {
    private val id: String = TripReplayPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { TripReplayRoute(it) }
    }
}
