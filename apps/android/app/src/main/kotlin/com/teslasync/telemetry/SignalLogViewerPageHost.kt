// Page-host wiring for the SignalLogViewerPage telemetry surface (A7) — the seam that attaches real screen content to
// the `signalLog` ⁄ `/signal-log` navigation destination (Destinations.kt, already a metadata-only route). It mirrors
// the sibling [io.teslasync.android.telemetry.signalgapdetector.SignalGapDetectorPageHost] precedent: [register] is
// called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to
// the shared not-found screen. [SignalLogViewerRoute] reads the app DI graph from [LocalDataContainer], builds the
// page's source over a page-local telemetry repository (constructed from the shared resilient client + offline cache
// the container exposes, since the Android DI graph wires no TelemetryStore yet — the RegenEfficiencyPage
// `HttpDrivingRepository` precedent) + the app-scoped active-vehicle selection, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signallogviewer

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `signalLog` destination. Resolves the app data graph from the
 * CompositionLocal, builds the page source over a page-local [HttpTelemetryRepository] (the shared resilient client +
 * offline cache) + the app-scoped active-vehicle selection, and binds the page to the app's redacting logger. This
 * route owns no data of its own — the deferred history query lives entirely in the view-model.
 */
@Composable
fun SignalLogViewerRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            signalLogViewerPageSourceOf(
                telemetryRepository = HttpTelemetryRepository(container.api, container.cacheStore),
                selectedVehicleStore = container.selectedVehicleStore,
            )
        }
    SignalLogViewerPage(source = source, logger = container.logger)
}

/**
 * Registers the [SignalLogViewerRoute] host for the `signalLog` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SignalLogViewerPageHost {
    private val id: String = SignalLogViewerPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SignalLogViewerRoute() }
    }
}
