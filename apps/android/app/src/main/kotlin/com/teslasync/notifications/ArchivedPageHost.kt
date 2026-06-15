// Page-host wiring for the ArchivedPage notifications surface (A7) — the seam that attaches real screen content
// to the `notificationsArchived` ⁄ `/notifications/archived` navigation destination (Destinations.kt, already
// a metadata-only route). It mirrors the sibling [io.teslasync.android.admin.feedback.FeedbackQueuePageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until
// then the route falls through to the shared not-found screen. [ArchivedRoute] reads the app DI graph from
// [LocalDataContainer], binds the page to a notifications repository over the shared resilient client + offline
// cache and to the shared S8 VehiclesStore via [archivedPageSourceOf], and performs no HTTP itself.
//
// The notifications feeds are bound through an [HttpNotificationsRepository] (the same resilient client +
// cache the shared stores run on) rather than a shared store so the view-model controls the refresh the
// InboxBody freshness contract drives; the vehicle list comes from the shared S8 holder.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.archived

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository

/**
 * The stateful route entry registered for the `notificationsArchived` destination. Resolves the app data
 * graph from the CompositionLocal, builds the source over a notifications repository (the shared resilient
 * client + offline cache) and the shared S8 VehiclesStore, and binds the page to the app's redacting logger.
 */
@Composable
fun ArchivedRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            archivedPageSourceOf(
                repo = HttpNotificationsRepository(container.api, container.cacheStore),
                vehiclesStore = container.vehiclesStore,
            )
        }
    ArchivedPage(source = source, logger = container.logger)
}

/**
 * Registers the [ArchivedRoute] host for the `notificationsArchived` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ArchivedPageHost {
    private val id: String = ArchivedPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ArchivedRoute() }
    }
}
