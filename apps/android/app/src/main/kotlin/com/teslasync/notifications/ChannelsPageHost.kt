// Page-host wiring for the ChannelsPage notifications surface (A7) — the seam that attaches real screen content
// to the `notificationsChannels` ⁄ `/notifications/channels` navigation destination (Destinations.kt, already a
// metadata-only route). It mirrors the sibling [io.teslasync.android.notifications.archived.ArchivedPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then
// the route falls through to the shared not-found screen. [ChannelsRoute] reads the app DI graph from
// [LocalDataContainer], binds the embedded NotificationChannelsView feature view to a notifications repository over
// the shared resilient client + offline cache (via [notificationChannelsViewSource]), and performs no HTTP itself.
//
// The channel feeds are bound through an [HttpNotificationsRepository] (the same resilient client + cache the
// shared stores run on) rather than a shared store so the view-model controls the refetch-on-retry the channel
// surface's freshness contract drives — exactly as the sibling ArchivedPage binds its inbox feeds.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.channels

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.notificationchannelsview.notificationChannelsViewSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository

/**
 * The stateful route entry registered for the `notificationsChannels` destination. Resolves the app data graph
 * from the CompositionLocal, builds the feature view's source over a notifications repository (the shared
 * resilient client + offline cache), and binds the page to the app's redacting logger. The cache-then-network
 * channel + stats feeds and the four channel mutations live entirely in the embedded NotificationChannelsView
 * feature view; this route owns no data of its own.
 */
@Composable
fun ChannelsRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            notificationChannelsViewSource(
                repository = HttpNotificationsRepository(container.api, container.cacheStore),
            )
        }
    ChannelsPage(source = source, logger = container.logger)
}

/**
 * Registers the [ChannelsRoute] host for the `notificationsChannels` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object ChannelsPageHost {
    private val id: String = ChannelsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { ChannelsRoute() }
    }
}
