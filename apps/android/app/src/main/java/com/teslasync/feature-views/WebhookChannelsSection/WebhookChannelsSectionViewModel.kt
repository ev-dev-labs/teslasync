// UI-thread-free state holder backing the WebhookChannelsSection feature view — the native port of the hook
// composition the web component owns (web/src/features/settings/components/WebhookChannelsSection.tsx). It binds
// the shared cache-then-network [WebhookChannelsSectionSource] (P1/S8), projects the webhook-channel list onto the
// shared [UiState] surface (loading / content / empty / stale / offline / error), exposes the refresh/retry
// action, runs the channel mutations (web `useSaveChannel` / `useDeleteChannel` / `useToggleChannel`) raising typed
// [WebhookToast]s, owns the per-row test-result map + in-flight test id (web `testResults` / `testMut.variables`),
// fronts the live signature preview (web `useWebhookSignaturePreview`), and emits the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WebhookChannelsSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.webhookchannelssection

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.NotificationChannelsRepository
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannelsStore
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [WebhookChannelsSection]. It consumes the cache-then-network
 * [WebhookChannelsSectionSource] (P1/S8) and re-shares the webhook read as a [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty webhook
 * list maps to the empty surface (web `sortedWebhooks.length === 0` → `<EmptyState />`); an error keeps the
 * best-effort cached rows visible with the offline/error chip + retry, never blanking working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect the feed; the mutations delegate to the source, raise the
 * matching [WebhookToast] (toggle/delete) or surface the structured result inline ([test]), and refresh the read
 * so a write is reflected regardless of which source binding the host wired. [save] returns the [Result] so the
 * modal closes on success or shows its inline error on failure; [previewSignature] fronts the live HMAC preview.
 * [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network webhook seam (shared-layer adapters in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WebhookChannelsSectionViewModel(
    private val source: WebhookChannelsSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network read (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val testingId = MutableStateFlow<Long?>(null)
    private val testResultsState = MutableStateFlow<Map<Long, WebhookTestResult>>(emptyMap())
    private val toastChannel = Channel<WebhookToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The webhook-channel list as cache-then-network UI state: loading / content / empty (web
     * `sortedWebhooks.length === 0`) / stale / offline / error, carrying the freshness stamp + error kind.
     */
    val webhookChannels: StateFlow<UiState<List<NotificationChannel.Webhook>>> =
        refreshTrigger
            .flatMapLatest { source.webhookChannels() }
            .asUiState { it.isEmpty() }

    /** The id of the channel whose per-row test is in flight (web `testMut.variables?.id === ch.id`), else `null`. */
    val testingChannelId: StateFlow<Long?> = testingId

    /** The per-row structured test results, keyed by channel id — the web `testResults` record rendered inline. */
    val testResults: StateFlow<Map<Long, WebhookTestResult>> = testResultsState

    /** Typed mutation toasts the composable maps to localized [WebhookToast] surfaces (web global toasts). */
    val toasts: Flow<WebhookToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load (web `useInvalidateWebhookChannels` + `refetch`); backs retry. */
    fun refresh() {
        logger.info("webhookChannels.refresh")
        source.invalidate()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Toggles [channel]'s enabled state (web `useToggleChannel`). Raises [WebhookToast.Disabled] /
     * [WebhookToast.Enabled] on success (matching the generic hook's "Channel disabled" / "Channel enabled") or
     * [WebhookToast.ToggleFailed] on failure, then refreshes the read.
     */
    fun toggle(channel: NotificationChannel.Webhook) {
        launch {
            source.toggleChannel(channel.id).fold(
                onSuccess = {
                    emitToast(if (channel.enabled) WebhookToast.Disabled else WebhookToast.Enabled)
                    refreshRead()
                },
                onFailure = { emitToast(WebhookToast.ToggleFailed) },
            )
        }
    }

    /**
     * Deletes [channel] (web `useDeleteChannel` from the confirm dialog). Raises [WebhookToast.Deleted] on success
     * (or [WebhookToast.DeleteFailed] on failure), drops its inline test result (web `delete next[id]`), then
     * refreshes the read.
     */
    fun delete(channel: NotificationChannel.Webhook) {
        launch {
            source.deleteChannel(channel.id).fold(
                onSuccess = {
                    emitToast(WebhookToast.Deleted)
                    testResultsState.update { it - channel.id }
                    refreshRead()
                },
                onFailure = { emitToast(WebhookToast.DeleteFailed) },
            )
        }
    }

    /**
     * Fires the per-row test for [channel] (web `useTestWebhookChannel`). Tracks [testingChannelId] for the row
     * spinner and stores the structured result in [testResults]; a transport failure is folded into a
     * `success = false` result carrying the error (web `onError` synthesises `{ success:false, status_code:0,
     * latency_ms:0, error }`). The endpoint answers HTTP 200 in every delivery outcome, so a non-2xx receiver is a
     * successful [Result] with `success == false`.
     */
    fun test(channel: NotificationChannel.Webhook) {
        testingId.value = channel.id
        launch {
            try {
                val result =
                    source.testWebhookChannel(channel.id, null, null).getOrElse { error ->
                        WebhookTestResult(success = false, statusCode = 0, latencyMs = 0, error = error.message ?: error.toString())
                    }
                testResultsState.update { it + (channel.id to result) }
            } finally {
                testingId.update { current -> current.takeIf { it != channel.id } }
            }
        }
    }

    /**
     * Creates or updates a webhook channel (web modal `useSaveChannel`). Returns the [Result] so the modal closes
     * on success or shows the inline form error on failure (web `onSuccess` / `onError`). Refreshes the read on
     * success so the new/edited row appears.
     */
    suspend fun save(input: NotificationChannelInput): Result<NotificationChannel> = source.saveChannel(input).onSuccess { refreshRead() }

    /**
     * Computes the `X-TeslaSync-Signature` for a `(secret, body)` pair (web `useWebhookSignaturePreview`). The
     * modal debounces calls and renders the result inline; callers guard with a non-blank secret first (an empty
     * secret is rejected 400 server-side).
     */
    suspend fun previewSignature(
        secret: String,
        body: String,
    ): Result<WebhookSignaturePreviewResult> = source.previewWebhookSignature(secret, body)

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no channel name, URL, or secret, so a diagnostics line can never leak what a user configured.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordWebhookChannelsViewOpened(logger)
    }

    private fun refreshRead() {
        source.invalidate()
        refreshTrigger.update { it + 1 }
    }

    private fun emitToast(toast: WebhookToast) {
        toastChannel.trySend(toast)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: WebhookChannelsSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WebhookChannelsSectionViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [NotificationChannelsStore] + [NotificationsStore]. */
        fun create(
            channelsStore: NotificationChannelsStore,
            notificationsStore: NotificationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): WebhookChannelsSectionViewModel =
            WebhookChannelsSectionViewModel(webhookChannelsSectionSource(channelsStore, notificationsStore), logger, scope)

        /** Wire the surface from the shared **S7** [NotificationChannelsRepository] + [NotificationsRepository]. */
        fun create(
            channelsRepository: NotificationChannelsRepository,
            notificationsRepository: NotificationsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): WebhookChannelsSectionViewModel =
            WebhookChannelsSectionViewModel(
                webhookChannelsSectionSource(channelsRepository, notificationsRepository),
                logger,
                scope,
            )
    }
}
