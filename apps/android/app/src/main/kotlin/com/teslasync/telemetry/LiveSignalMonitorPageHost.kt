// Page-host wiring for the LiveSignalMonitorPage surface (A7) — the seam that attaches real screen content to the
// `liveSignalMonitor` ⁄ `/live-monitor` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.dashboard.glance.GlancePageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [LiveSignalMonitorRoute] resolves the app DI graph from [LocalDataContainer] and binds the page-header
// connection slice to the app-scoped shared `LiveSessionStore` (the single SSE stream, ADR-009); the live tail
// inside the page binds the same store itself. It performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.livesignalmonitor

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `liveSignalMonitor` destination. Resolves the app data graph from
 * the CompositionLocal, builds the source over the shared app-scoped [io.teslasync.android.data.live.LiveSessionStore]
 * (the single SSE stream), and binds the page to the app's redacting logger.
 */
@Composable
fun LiveSignalMonitorRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { liveSignalMonitorPageSource(container.liveSessionStore) }
    LiveSignalMonitorPage(source = source, logger = container.logger)
}

/**
 * Registers the [LiveSignalMonitorRoute] host for the `liveSignalMonitor` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object LiveSignalMonitorPageHost {
    private val id: String = LiveSignalMonitorPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { LiveSignalMonitorRoute() }
    }
}
