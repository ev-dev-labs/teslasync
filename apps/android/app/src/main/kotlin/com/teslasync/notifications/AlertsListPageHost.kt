// Page-host wiring for the AlertsListPage notifications surface (A7) — the seam that attaches real screen content to
// the `notificationsAlerts` ⁄ `/notifications/alerts` navigation destination (Destinations.kt). It mirrors the sibling
// page-host precedents (e.g. [io.teslasync.android.analytics.statistics.StatisticsPageHost]): [register] is called
// once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the
// shared not-found screen. [AlertsListRoute] reads the app DI graph from [LocalDataContainer] and binds the page to
// page-local Notifications + Pinned HTTP repositories built over the SAME shared resilient client + offline cache the
// other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) — the
// DataContainer wires no NotificationsStore yet, exactly as the sibling DrivesList / Statistics surfaces build their
// page-local reads. The route performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.alertslist

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import io.teslasync.shared.core.data.repo.HttpPinnedRepository

/**
 * The stateful route entry registered for the `notificationsAlerts` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over page-local [HttpNotificationsRepository] + [HttpPinnedRepository]
 * (constructed from the shared client + offline cache the container exposes), and binds the page to the app's
 * redacting logger.
 */
@Composable
fun AlertsListRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            alertsListPageSourceOf(
                notifications = HttpNotificationsRepository(container.api, container.cacheStore),
                pinned = HttpPinnedRepository(container.api, container.cacheStore),
            )
        }
    AlertsListPage(source = source, logger = container.logger)
}

/**
 * Registers the [AlertsListRoute] host for the `notificationsAlerts` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object AlertsListPageHost {
    private val id: String = AlertsListPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { AlertsListRoute() }
    }
}
