// Page-host wiring for the WebhooksPage notifications surface (A7) — the seam that attaches real screen content
// to the `notificationsWebhooks` ⁄ `/notifications/webhooks` navigation destination (Destinations.kt, already a
// metadata-only route). It mirrors the sibling [io.teslasync.android.notifications.channels.ChannelsPageHost]
// precedent: [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then
// the route falls through to the shared not-found screen. [WebhooksRoute] reads the app DI graph from
// [LocalDataContainer], binds the embedded WebhookChannelsSection feature view to the notification-channels +
// notifications repositories over the shared resilient client + offline cache (via [webhookChannelsSectionSource]),
// and performs no HTTP itself.
//
// The webhook feeds are bound through the [HttpNotificationChannelsRepository] (the filtered kind=webhook read +
// the HMAC test + signature preview) and the generic [HttpNotificationsRepository] (the channel CRUD) — the same
// resilient client + cache the shared stores run on — rather than a shared store so the view-model controls the
// refetch-on-retry the webhook surface's freshness contract drives, exactly as the sibling ChannelsPage binds its
// channel feeds.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.webhooks

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.webhookchannelssection.webhookChannelsSectionSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpNotificationChannelsRepository
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository

/**
 * The stateful route entry registered for the `notificationsWebhooks` destination. Resolves the app data graph
 * from the CompositionLocal, builds the feature view's source over the notification-channels repository (the
 * filtered webhook read + HMAC test + signature preview) and the generic notifications repository (the channel
 * CRUD) — both on the shared resilient client + offline cache — and binds the page to the app's redacting logger.
 * The cache-then-network webhook feed and the create/edit/toggle/delete/test mutations live entirely in the
 * embedded WebhookChannelsSection feature view; this route owns no data of its own.
 */
@Composable
fun WebhooksRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            webhookChannelsSectionSource(
                channelsRepository = HttpNotificationChannelsRepository(container.api, container.cacheStore),
                notificationsRepository = HttpNotificationsRepository(container.api, container.cacheStore),
            )
        }
    WebhooksPage(source = source, logger = container.logger)
}

/**
 * Registers the [WebhooksRoute] host for the `notificationsWebhooks` route. Called once at process start;
 * idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object WebhooksPageHost {
    private val id: String = WebhooksPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { WebhooksRoute() }
    }
}
