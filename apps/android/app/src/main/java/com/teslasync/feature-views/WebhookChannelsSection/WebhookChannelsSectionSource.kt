// The data port the WebhookChannelsSection feature view binds to (P1/S8 state-holder seam) — the native analogue
// of the web component's hook composition
// (web/src/api/hooks/useNotificationChannels.ts -> web/src/features/settings/components/WebhookChannelsSection.tsx).
// The view never performs HTTP itself; a shared adapter (the S8 stores or the S7 repositories) or a test fake
// drives this. Cache-then-network freshness is preserved end to end (ADR-013): every read emission's
// cached/stale/error flags flow through unchanged so the view-model can render the full state matrix.
//
// The six operations map one-to-one onto the web hooks the section uses: the filtered read is `useWebhookChannels`
// (the `useNotificationChannels` list filtered to `kind === 'webhook'`); [saveChannel]/[deleteChannel]/
// [toggleChannel] are the generic `useSaveChannel`/`useDeleteChannel`/`useToggleChannel` (they refresh the shared
// channel list, so the filtered read updates without cross-store plumbing); [testWebhookChannel] is the HMAC-aware
// `useTestWebhookChannel`; [previewWebhookSignature] is `useWebhookSignaturePreview`. Test + preview invalidate
// nothing (their result is rendered inline), exactly like the web mutations.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/WebhookChannelsSection) cannot form a valid Kotlin package and the file hosts the
// seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.webhookchannelssection

import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.filterWebhookChannels
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannelsStore
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [WebhookChannelsSectionViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store or the network. [webhookChannels] is the cache-then-network feed the web
 * `useWebhookChannels` serves (already filtered to webhook rows); [invalidate] is the web
 * `useInvalidateWebhookChannels` re-fetch trigger; the five mutations mirror the web `useSaveChannel` /
 * `useDeleteChannel` / `useToggleChannel` / `useTestWebhookChannel` / `useWebhookSignaturePreview` non-throwing
 * results. No HTTP touches the view.
 */
interface WebhookChannelsSectionSource {
    /** Stream the cache-then-network webhook-channel list (web `useWebhookChannels`, the `kind === 'webhook'` filter). */
    fun webhookChannels(): Flow<Resource<List<NotificationChannel.Webhook>>>

    /** Re-fetch the webhook-channel feed (web `useInvalidateWebhookChannels`); a no-op for a feed nobody observes. */
    fun invalidate()

    /** Create or update a channel (web `useSaveChannel`); refreshes the channel list on success. */
    suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel>

    /** Delete a channel (web `useDeleteChannel`); refreshes the channel list + stats on success. */
    suspend fun deleteChannel(id: Long): Result<Unit>

    /** Toggle a channel's enabled state (web `useToggleChannel`); refreshes the channel list + stats. */
    suspend fun toggleChannel(id: Long): Result<NotificationChannel>

    /**
     * Fire a structured webhook test through the HMAC-aware delivery path (web `useTestWebhookChannel`). Returns
     * the structured result even for a non-2xx receiver (the endpoint answers HTTP 200 in every delivery outcome);
     * invalidates nothing — the row renders the result inline.
     */
    suspend fun testWebhookChannel(
        id: Long,
        title: String?,
        message: String?,
    ): Result<WebhookTestResult>

    /**
     * Compute the `X-TeslaSync-Signature` for a `(secret, body)` pair (web `useWebhookSignaturePreview`). A pure
     * utility; invalidates nothing. An empty secret is rejected 400 server-side (callers guard first).
     */
    suspend fun previewWebhookSignature(
        secret: String,
        body: String,
    ): Result<WebhookSignaturePreviewResult>
}

/**
 * Binds the surface to the shared **S8** holders: the [NotificationChannelsStore] owns the filtered webhook read,
 * the HMAC test, the signature preview, and the invalidate trigger (web `useNotificationChannels.ts`), while the
 * generic [NotificationsStore] owns the channel CRUD (web `useSaveChannel`/`useDeleteChannel`/`useToggleChannel`).
 * CRUD routes through [NotificationsStore], which refreshes the shared `channels` feed the webhook read derives
 * from; the view-model additionally calls [invalidate] so the dedicated webhook feed re-fetches uniformly. No HTTP
 * touches the view — the stores (S7/S8) own it.
 */
fun webhookChannelsSectionSource(
    channelsStore: NotificationChannelsStore,
    notificationsStore: NotificationsStore,
): WebhookChannelsSectionSource =
    object : WebhookChannelsSectionSource {
        override fun webhookChannels(): Flow<Resource<List<NotificationChannel.Webhook>>> = channelsStore.webhookChannels()

        override fun invalidate() = channelsStore.invalidateWebhookChannels()

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> =
            notificationsStore.saveChannel(input)

        override suspend fun deleteChannel(id: Long): Result<Unit> = notificationsStore.deleteChannel(id)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = notificationsStore.toggleChannel(id)

        override suspend fun testWebhookChannel(
            id: Long,
            title: String?,
            message: String?,
        ): Result<WebhookTestResult> = channelsStore.testWebhookChannel(id, title, message)

        override suspend fun previewWebhookSignature(
            secret: String,
            body: String,
        ): Result<WebhookSignaturePreviewResult> = channelsStore.previewWebhookSignature(secret, body)
    }

/**
 * Binds the surface directly to the shared **S7** repositories. The [NotificationChannelsRepository] serves the
 * raw `GET /notifications` list (filtered to webhook rows here via [filterWebhookChannels], the web
 * `useWebhookChannels`) plus the HMAC test + signature preview; the generic [NotificationsRepository] serves the
 * channel CRUD. Each [webhookChannels] call starts a NEW cache-then-network collection, so the view-model's
 * refresh/retry trigger a genuine re-fetch (the web `refetch()` behaviour) and [invalidate] is a no-op — the
 * binding to use when a host does not share app-wide stores.
 */
fun webhookChannelsSectionSource(
    channelsRepository: NotificationChannelsRepository,
    notificationsRepository: NotificationsRepository,
): WebhookChannelsSectionSource =
    object : WebhookChannelsSectionSource {
        override fun webhookChannels(): Flow<Resource<List<NotificationChannel.Webhook>>> =
            channelsRepository.channels().map { it.mapData(::filterWebhookChannels) }

        override fun invalidate() = Unit

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> =
            notificationsRepository.saveChannel(input)

        override suspend fun deleteChannel(id: Long): Result<Unit> = notificationsRepository.deleteChannel(id)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = notificationsRepository.toggleChannel(id)

        override suspend fun testWebhookChannel(
            id: Long,
            title: String?,
            message: String?,
        ): Result<WebhookTestResult> = channelsRepository.testWebhookChannel(id, title, message)

        override suspend fun previewWebhookSignature(
            secret: String,
            body: String,
        ): Result<WebhookSignaturePreviewResult> = channelsRepository.previewWebhookSignature(secret, body)
    }

/** Maps a [Resource]'s `data` and `cached` slots through [f], preserving the freshness flags (ADR-013). */
private fun <A, B> Resource<A>.mapData(f: (A) -> B): Resource<B> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(f), fetchedAt, stale)
        is Resource.Success -> Resource.Success(f(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(f), fetchedAt, stale, error)
    }
