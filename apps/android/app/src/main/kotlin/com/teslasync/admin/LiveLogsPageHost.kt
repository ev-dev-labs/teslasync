// Page-host wiring for the LiveLogsPage admin surface (A7) — the seam that attaches real screen content to
// the surface's stable `LiveLogsPage` page-host id. It mirrors the [ApiLogsPageHost] precedent: [register] is
// called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the id resolves to
// nothing (the web page is unrouted, so there is no Destinations row — it is reached as an embedded admin
// surface, not a top-level URL). [LiveLogsRoute] reads the app DI graph from [LocalDataContainer], binds the
// page to the shared S6 [io.teslasync.shared.core.net.sse.SseTransport] via [asLiveLogsSource], and performs
// no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.livelogs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `LiveLogsPage` page-host id. Resolves the app data graph from
 * the CompositionLocal, builds the live-log source over the shared authenticated SSE transport, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun LiveLogsRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.sseTransport.asLiveLogsSource() }
    LiveLogsPage(source = source, logger = container.logger)
}

/**
 * Registers the [LiveLogsRoute] host for the `LiveLogsPage` id. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object LiveLogsPageHost {
    private val id: String = LiveLogsRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { LiveLogsRoute() }
    }
}
