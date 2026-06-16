// Page-host wiring for the SystemStatusPage system surface (A7) — the seam that attaches real screen content to the
// `systemStatus` ⁄ `/system-status` navigation destination (Destinations.kt). It mirrors the sibling
// [io.teslasync.android.admin.apilogs.ApiLogsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route resolves to the shared not-found screen.
// [SystemStatusRoute] reads the app DI graph from [LocalDataContainer] and binds the page to the shared S8 holders
// the container already exposes (Admin, Settings, Vehicles). The container wires no Notifications holder yet, so —
// exactly as the sibling DiagnosticPage constructs its own page-local store — this host builds a page-local
// [NotificationsStore] over the shared resilient client + offline cache the container exposes, scoped to the route
// composition. No HTTP touches the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.systemstatus

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import io.teslasync.shared.core.presentation.notifications.NotificationsStore

/**
 * The stateful route entry registered for the `systemStatus` destination. Resolves the app data graph from the
 * CompositionLocal, binds the four Admin reads + auth + the vehicle list to the shared holders, builds a
 * page-local Notifications holder for the stats read over the shared client + cache, and binds the page to the
 * app's redacting logger.
 */
@Composable
fun SystemStatusRoute() {
    val container = LocalDataContainer.current
    val scope = rememberCoroutineScope()
    val source =
        remember(container, scope) {
            systemStatusSourceOf(
                adminStore = container.adminStore,
                settingsStore = container.settingsStore,
                notificationsStore =
                    NotificationsStore(
                        HttpNotificationsRepository(container.api, container.cacheStore),
                        scope,
                    ),
                vehiclesStore = container.vehiclesStore,
            )
        }
    SystemStatusPage(source = source, logger = container.logger)
}

/**
 * Registers the [SystemStatusRoute] host for the `systemStatus` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object SystemStatusPageHost {
    private val id: String = SystemStatusPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { SystemStatusRoute() }
    }
}
