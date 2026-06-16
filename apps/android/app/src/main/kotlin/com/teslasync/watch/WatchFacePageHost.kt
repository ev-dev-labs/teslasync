// Page-host wiring for the WatchFacePage wearable surface (A7) — the seam that attaches real screen content to
// the `watchFace` ⁄ `/watch` standalone navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.vehiclesystems.mediaplayer.MediaPlayerPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [WatchFaceRoute] resolves the app DI graph from [LocalDataContainer], binds the page-local
// Watch source over the shared resilient client + offline cache the container exposes, and performs no HTTP
// itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/watch) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.watch.watchface

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `watchFace` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared resilient client + offline cache, and binds the page to
 * the app's redacting logger + live unit formatter. The watch route carries no `vehicle_id` argument, so the
 * page reads the primary vehicle (web `vehicleId === undefined`).
 */
@Composable
fun WatchFaceRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { watchFacePageSourceOf(api = container.api, cacheStore = container.cacheStore) }
    WatchFacePage(source = source, logger = container.logger)
}

/**
 * Registers the [WatchFaceRoute] host for the `watchFace` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object WatchFacePageHost {
    private val id: String = WatchFaceRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { WatchFaceRoute() }
    }
}
