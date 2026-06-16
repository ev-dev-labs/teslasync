// Page-host wiring for the SignalGapDetectorPage telemetry surface (A7) — the seam that attaches real screen content to
// the `signalGaps` ⁄ `/signal-gaps` navigation destination (Destinations.kt, already a metadata-only route). It mirrors
// the sibling [io.teslasync.android.driving.regenefficiency.RegenEfficiencyPageHost] precedent: [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared
// not-found screen. [SignalGapDetectorRoute] reads the app DI graph from [LocalDataContainer], builds the embedded
// SignalCatalogPanel's source over a page-local telemetry repository (constructed from the shared resilient client +
// offline cache the container exposes, since the Android DI graph wires no TelemetryStore yet — the RegenEfficiencyPage
// `HttpDrivingRepository` precedent), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signalgapdetector

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.signalcatalogpanel.asSignalCatalogPanelSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `signalGaps` destination. Resolves the app data graph from the
 * CompositionLocal, builds the embedded SignalCatalogPanel's source over a page-local [HttpTelemetryRepository] (the
 * shared resilient client + offline cache), and binds the page to the app's redacting logger. The page's own selection
 * scope (web `useSelectedVehicle`) is read from the shared selection + fleet holders inside [SignalGapDetectorPage];
 * the live-signals feed lives entirely in the embedded feature view. This route owns no data of its own.
 */
@Composable
fun SignalGapDetectorRoute() {
    val container = LocalDataContainer.current
    val catalogSource =
        remember(container) {
            HttpTelemetryRepository(container.api, container.cacheStore).asSignalCatalogPanelSource()
        }
    SignalGapDetectorPage(catalogSource = catalogSource, logger = container.logger)
}

/**
 * Registers the [SignalGapDetectorRoute] host for the `signalGaps` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SignalGapDetectorPageHost {
    private val id: String = SignalGapDetectorPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SignalGapDetectorRoute() }
    }
}
