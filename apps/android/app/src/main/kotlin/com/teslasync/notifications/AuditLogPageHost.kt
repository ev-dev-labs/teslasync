// Page-host wiring for the AuditLogPage notifications surface (A7) — the seam that attaches real screen content
// to the `notificationsAudit` ⁄ `/notifications/audit` navigation destination (Destinations.kt). It mirrors the
// [ApiLogsPageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found
// screen. [AuditLogRoute] reads the app DI graph from [LocalDataContainer], binds the page to the shared S8
// [io.teslasync.shared.core.presentation.admin.AdminStore] via [asAuditLogSource], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.auditlog

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts

/**
 * The stateful route entry registered for the `notificationsAudit` destination. Resolves the app data graph
 * from the CompositionLocal, builds the cache-then-network source over the shared Admin holder, and binds the
 * page to the app's redacting logger.
 */
@Composable
fun AuditLogRoute() {
    val container = LocalDataContainer.current
    val source = remember(container) { container.adminStore.asAuditLogSource() }
    AuditLogPage(source = source, logger = container.logger)
}

/**
 * Registers the [AuditLogRoute] host for the `notificationsAudit` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AuditLogPageHost {
    private val id: String = AuditLogPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AuditLogRoute() }
    }
}
