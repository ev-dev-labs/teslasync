// Page-host wiring for the DiagnosticPage system surface (A7) — the seam that attaches real screen content to the
// `DiagnosticPage` Navigation-Compose destination. The web page is UNROUTED (no `web/src/App.tsx` route, so no
// `Destinations` row), so TeslaSyncNavHost registers an explicit `composable("DiagnosticPage")` destination that
// resolves through [io.teslasync.android.navigation.PageHosts]; this host registers the content for that key. It
// mirrors the sibling [io.teslasync.android.poweruser.sqlplayground.SqlPlaygroundPageHost] precedent: [register] is
// called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to
// the shared not-found screen. [DiagnosticRoute] reads the app DI graph from [LocalDataContainer] and constructs a
// page-local [io.teslasync.shared.core.presentation.systemdiagnostic.SystemDiagnosticStore] over the shared resilient
// client the container exposes (the Android DI graph wires no diagnostic store yet, exactly as the sibling Commands /
// SqlPlayground surfaces document), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.diagnostic

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSystemDiagnosticRepository
import io.teslasync.shared.core.presentation.systemdiagnostic.SystemDiagnosticStore

/**
 * The stateful route entry registered for the `DiagnosticPage` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local SystemDiagnosticStore (constructed from the shared resilient
 * client the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun DiagnosticRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            diagnosticPageSourceOf(
                store = SystemDiagnosticStore(HttpSystemDiagnosticRepository(container.api)),
            )
        }
    DiagnosticPage(source = source, logger = container.logger)
}

/**
 * Registers the [DiagnosticRoute] host for the `DiagnosticPage` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DiagnosticPageHost {
    private val id: String = DiagnosticPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DiagnosticRoute() }
    }
}
