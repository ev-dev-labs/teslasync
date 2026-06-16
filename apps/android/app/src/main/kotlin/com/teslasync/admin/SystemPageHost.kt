// Page-host wiring for the SystemPage admin surface (A7) — the seam that attaches real screen content to the
// `adminSystem` ⁄ `/admin/system` navigation destination (Destinations.kt). It mirrors the
// [io.teslasync.android.admin.schemadrift.SchemaDriftPageHost] precedent: [register] is called once at
// process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [SystemRoute] reads the app DI graph from [LocalDataContainer], binds the page to
// the shared S8 SystemStore (rate limits) + SystemQueuesStore (worker queues), and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.system

import androidx.compose.runtime.Composable
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `adminSystem` destination. Resolves the app data graph from the
 * CompositionLocal, binds the page to the shared S8 SystemStore + SystemQueuesStore holders, and hands the
 * app's redacting logger to the page.
 */
@Composable
fun SystemRoute() {
    val container = LocalDataContainer.current
    SystemPage(
        systemStore = container.systemStore,
        systemQueuesStore = container.systemQueuesStore,
        logger = container.logger,
    )
}

/**
 * Registers the [SystemRoute] host for the `adminSystem` route. Called once at process start; idempotent so a
 * repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SystemPageHost {
    private val id: String = SystemPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SystemRoute() }
    }
}
