// Page-host wiring for the GDPRExportPage admin surface (A7) — the seam that attaches real screen content to
// the `adminGdprExports` ⁄ `/admin/gdpr-exports` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.apilogs.ApiLogsPageHost] precedent: [register] is called once at process start
// by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [GDPRExportRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] via [asGdprExportSource],
// and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.gdpr

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminGdprExports` destination. Resolves the app data graph
 * from the CompositionLocal, builds the source over the shared S8 Operator-Confidence holder, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun GDPRExportRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.operatorConfidenceStore.asGdprExportSource() }
    GDPRExportPage(source = source, logger = container.logger)
}

/**
 * Registers the [GDPRExportRoute] host for the `adminGdprExports` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object GDPRExportPageHost {
    private val id: String = GDPRExportPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { GDPRExportRoute() }
    }
}
