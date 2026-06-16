// Page-host wiring for the DLQInspectorPage admin surface (A7) — the seam that attaches real screen content to
// the `adminDlq` ⁄ `/admin/dlq` navigation destination (Destinations.kt). It mirrors the [ApiLogsPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [DLQInspectorRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared S8 [io.teslasync.shared.core.presentation.dlq.DlqStore]
// via [asDLQInspectorSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.dlq

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminDlq` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared DLQ holder, and binds the page to the
 * app's redacting logger.
 */
@Composable
fun DLQInspectorRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.dlqStore.asDLQInspectorSource() }
    DLQInspectorPage(source = source, logger = container.logger)
}

/**
 * Registers the [DLQInspectorRoute] host for the `adminDlq` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DLQInspectorPageHost {
    private val id: String = DLQInspectorPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DLQInspectorRoute() }
    }
}
