package io.teslasync.shared.core.presentation.notificationchannels

import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.filterWebhookChannels
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the NotificationChannels webhook surface — the cross-platform
 * port of the web `useNotificationChannels` hook domain
 * (web/src/api/hooks/useNotificationChannels.ts). Every native NotificationChannels screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the webhook-kind filter, or invalidation rules.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013)
 * derived to the webhook-kind rows: [webhookChannels] folds the `GET /notifications` channel list
 * (web `useNotificationChannels`) through [filterWebhookChannels] (the web `useWebhookChannels`
 * `kind === 'webhook'` filter, applied to every emission — cached, loading, and fresh). It is
 * lazily created on first access and shared so every observer folds into one upstream collection.
 *
 * The two mutations are non-throwing suspend [Result]s and — exactly like the web
 * `useTestWebhookChannel` / `useWebhookSignaturePreview` mutations — invalidate NOTHING: the
 * platform screen renders their structured result inline. The single targeted refresh is
 * [invalidateWebhookChannels], the port of the web `useInvalidateWebhookChannels` convenience that
 * invalidates `notificationKeys.channels`; it re-collects the cache-then-network channel feed,
 * which always re-fetches while replaying the last cached rows first (the web behaviour of keeping
 * prior data during a refetch). A feed nobody is observing is a no-op to refresh.
 *
 * The holder makes no network calls itself — it delegates entirely to the injected
 * [NotificationChannelsRepository] (S7). Toasts and optimistic UI are render-layer concerns and
 * are intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage
 * and is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class NotificationChannelsStore(
    private val repo: NotificationChannelsRepository,
    private val scope: CoroutineScope,
) {
    private val trigger: MutableStateFlow<Int> = MutableStateFlow(0)
    private var channelsFeed: StateFlow<Resource<List<NotificationChannel>>>? = null
    private var webhookFeed: StateFlow<Resource<List<NotificationChannel.Webhook>>>? = null

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable webhook-channel feed — the web `useWebhookChannels`: the
     * `GET /notifications` list (web `useNotificationChannels`) filtered to `kind === 'webhook'`
     * via [filterWebhookChannels] on every emission, so the `data` is always a (possibly empty)
     * list, never `undefined`.
     */
    public fun webhookChannels(): StateFlow<Resource<List<NotificationChannel.Webhook>>> =
        webhookFeed ?: channels()
            .map { it.mapData(::filterWebhookChannels) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            ).also { webhookFeed = it }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Fires a structured webhook test (web `useTestWebhookChannel`). Returns the structured result
     * even for a non-2xx receiver (the endpoint is HTTP 200 in every delivery outcome). Mirrors the
     * web mutation in invalidating NOTHING — the screen renders the result inline.
     */
    public suspend fun testWebhookChannel(
        id: Long,
        title: String? = null,
        message: String? = null,
    ): Result<WebhookTestResult> = repo.testWebhookChannel(id, title, message)

    /**
     * Computes the `X-TeslaSync-Signature` for a `(secret, body)` pair (web
     * `useWebhookSignaturePreview`). A pure utility mutation; invalidates nothing.
     */
    public suspend fun previewWebhookSignature(
        secret: String,
        body: String,
    ): Result<WebhookSignaturePreviewResult> = repo.previewWebhookSignature(secret, body)

    // ---- Actions ------------------------------------------------------------------

    /**
     * Invalidates the channel list (web `useInvalidateWebhookChannels`): re-fetches the feed if it
     * is being observed; a no-op when nobody has opened it.
     */
    public fun invalidateWebhookChannels() {
        trigger.update { it + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared raw-channel [StateFlow], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([invalidateWebhookChannels]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun channels(): StateFlow<Resource<List<NotificationChannel>>> =
        channelsFeed ?: trigger
            .flatMapLatest { repo.channels() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            ).also { channelsFeed = it }

    /** Maps a [Resource]'s `data` and `cached` slots through [f], preserving freshness flags. */
    private fun <A, B> Resource<A>.mapData(f: (A) -> B): Resource<B> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(f), fetchedAt, stale)
            is Resource.Success -> Resource.Success(f(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(f), fetchedAt, stale, error)
        }

    private companion object {
        // Keep the feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
