// Page-host wiring for the SignalDiffPage telemetry surface (A7) — the seam that attaches real screen content to the
// `signalDiff` ⁄ `/signal-diff` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.ingestxray.IngestXRayPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [SignalDiffRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8 Vehicles +
// Telemetry + Pinned holders via [signalDiffPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signaldiff

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `signalDiff` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Vehicles + Telemetry + Pinned holders, and
 * binds the page to the app's redacting logger.
 */
@Composable
fun SignalDiffRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            signalDiffPageSourceOf(
                vehiclesStore = container.vehiclesStore,
                telemetryStore = container.telemetryStore,
                pinnedStore = container.pinnedStore,
            )
        }
    SignalDiffPage(source = source, logger = container.logger)
}

/**
 * Registers the [SignalDiffRoute] host for the `signalDiff` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SignalDiffPageHost {
    private val id: String = SignalDiffPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SignalDiffRoute() }
    }
}
