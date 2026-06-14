// Page-host wiring for the ApiLogsPage admin surface (A7) — the seam that attaches real screen content to the
// `apiLogs` ⁄ `/api-logs` navigation destination (Destinations.kt). It mirrors the [SettingsPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [ApiLogsRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to the shared S8 [io.teslasync.shared.core.presentation.admin.AdminStore]
// via [asApiLogsSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.apilogs

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `apiLogs` destination. Resolves the app data graph from the
 * CompositionLocal, builds the cache-then-network source over the shared Admin holder, and binds the page to
 * the app's redacting logger.
 */
@Composable
fun ApiLogsRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.adminStore.asApiLogsSource() }
    ApiLogsPage(source = source, logger = container.logger)
}

/**
 * Registers the [ApiLogsRoute] host for the `apiLogs` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ApiLogsPageHost {
    private val id: String = ApiLogsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ApiLogsRoute() }
    }
}
