// Page-host wiring for the DBHealthPage system surface (A7) — the seam that attaches real screen content to the
// `dbHealth` ⁄ `/db-health` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.system.systemstatus.SystemStatusPageHost] precedent: [register] is called once at process
// start by [io.teslasync.android.TeslaSyncApplication]; until then the route resolves to the shared not-found
// screen. [DBHealthRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.admin.AdminStore] via [asDBHealthSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.dbhealth

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `dbHealth` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over the shared S8 [io.teslasync.shared.core.presentation.admin.AdminStore],
 * and binds the page to the app's redacting logger.
 */
@Composable
fun DBHealthRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.adminStore.asDBHealthSource() }
    DBHealthPage(source = source, logger = container.logger)
}

/**
 * Registers the [DBHealthRoute] host for the `dbHealth` route. Called once at process start; idempotent so a repeat
 * call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object DBHealthPageHost {
    private val id: String = DBHealthPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { DBHealthRoute() }
    }
}
