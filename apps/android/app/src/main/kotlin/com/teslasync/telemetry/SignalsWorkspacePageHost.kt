// Page-host wiring for the SignalsWorkspacePage telemetry surface (A7) — the seam that attaches real screen
// content to the `signalsWorkspace` ⁄ `/signals` navigation destination (Destinations.kt, already a metadata-only
// route). It mirrors the sibling [io.teslasync.android.telemetry.signalgapdetector.SignalGapDetectorPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then
// the route falls through to the shared not-found screen. [SignalsWorkspaceRoute] reads the app DI graph from
// [LocalDataContainer] and builds a page-local [HttpTelemetryRepository] over the shared resilient client +
// offline cache the container exposes (the Android DI graph wires no TelemetryStore yet — the SignalGapDetector /
// RegenEfficiency precedent), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signalsworkspace

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `signalsWorkspace` destination. Resolves the app data graph from
 * the CompositionLocal and builds a page-local [HttpTelemetryRepository] (the shared resilient client + offline
 * cache) the [SignalsWorkspacePage] wraps in its own [io.teslasync.shared.core.presentation.telemetry.TelemetryStore].
 * The page's selection scope (web `useSelectedVehicle`), pins (web `usePinned`), and live connection are read
 * from the shared P1/S8 holders inside the page; this route owns no data of its own.
 */
@Composable
fun SignalsWorkspaceRoute() {
    val container = LocalDataContainer.current
    val telemetryRepository =
        remember(container) { HttpTelemetryRepository(container.api, container.cacheStore) }
    SignalsWorkspacePage(telemetryRepository = telemetryRepository, logger = container.logger)
}

/**
 * Registers the [SignalsWorkspaceRoute] host for the `signalsWorkspace` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SignalsWorkspacePageHost {
    private val id: String = SignalsWorkspacePageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SignalsWorkspaceRoute() }
    }
}
