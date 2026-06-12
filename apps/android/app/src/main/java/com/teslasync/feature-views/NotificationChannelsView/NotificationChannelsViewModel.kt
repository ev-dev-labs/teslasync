// UI-thread-free state holder backing the NotificationChannelsView feature view — the native port of the
// notifications hook composition the web component owns
// (web/src/features/notifications/components/NotificationChannelsView.tsx). It binds the shared
// cache-then-network [NotificationChannelsViewSource] (P1/S8), projects the channel list + delivery stats onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error), exposes the refresh/retry
// action, runs the four channel mutations (web `useSaveChannel` / `useDeleteChannel` / `useToggleChannel` /
// `useTestChannel`) raising typed [ChannelToast]s, and emits the PII-safe `view.opened` diagnostic. The view
// never performs HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationChannelsView) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationchannelsview

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.ChannelTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
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
 * Lifecycle-aware state holder backing the Compose [NotificationChannelsView]. It consumes the cache-then-network
 * [NotificationChannelsViewSource] (P1/S8) and re-shares the two reads as [UiState] streams via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. An empty channel
 * list maps to the empty surface (web `channels.length === 0` → `<EmptyState />`); a resolved stats object always
 * renders content (web `stats ? grid : skeleton`, where an all-zero object still shows the grid). An error keeps
 * the best-effort cached data visible with the offline/error chip + retry, never blanking working content.
 *
 * It owns no networking. [refresh]/[retry] re-collect both feeds; the four mutations delegate to the source,
 * raise the matching [ChannelToast], and restart the read collection so a write is reflected regardless of which
 * source binding the host wired. [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network notifications seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationChannelsViewModel(
    private val source: NotificationChannelsViewSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network reads (manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val testingId = MutableStateFlow<Long?>(null)
    private val toastChannel = Channel<ChannelToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The channel list as cache-then-network UI state: loading / content / empty (web `channels.length === 0`) /
     * stale / offline / error, carrying the freshness stamp + error kind.
     */
    val channels: StateFlow<UiState<List<NotificationChannel>>> =
        refreshTrigger
            .flatMapLatest { source.channels() }
            .asUiState { it.isEmpty() }

    /**
     * The delivery stats as cache-then-network UI state. The emptiness predicate is `false` so a resolved stats
     * object always renders the grid (web parity: an all-zero object still shows tiles; the skeleton is the
     * transient pre-resolve state).
     */
    val stats: StateFlow<UiState<NotificationStats>> =
        refreshTrigger
            .flatMapLatest { source.stats() }
            .asUiState { false }

    /** The id of the channel whose per-card test is in flight (web `testMut.variables === ch.id`), else `null`. */
    val testingChannelId: StateFlow<Long?> = testingId

    /** Typed channel-mutation toasts the composable maps to localized [ChannelToast] surfaces (web `useToast`). */
    val toasts: Flow<ChannelToast> = toastChannel.receiveAsFlow()

    /** Re-runs the cache-then-network load of both reads (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info("notificationChannels.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Toggles [channel]'s enabled state (web `useToggleChannel`). Raises [ChannelToast.Enabled] /
     * [ChannelToast.Disabled] on success (matching the web `ch.enabled ? 'Channel disabled' : 'Channel enabled'`)
     * or [ChannelToast.ToggleFailed] on failure, then restarts the reads.
     */
    fun toggle(channel: NotificationChannel) {
        launch {
            source.toggleChannel(channel.id).fold(
                onSuccess = {
                    emitToast(if (channel.enabled) ChannelToast.Disabled else ChannelToast.Enabled)
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { emitToast(ChannelToast.ToggleFailed) },
            )
        }
    }

    /**
     * Deletes [channel] (web `useDeleteChannel`). Raises [ChannelToast.Deleted] on success or
     * [ChannelToast.DeleteFailed] on failure, then restarts the reads (the list + stats both change).
     */
    fun delete(channel: NotificationChannel) {
        launch {
            source.deleteChannel(channel.id).fold(
                onSuccess = {
                    emitToast(ChannelToast.Deleted)
                    refreshTrigger.update { it + 1 }
                },
                onFailure = { emitToast(ChannelToast.DeleteFailed) },
            )
        }
    }

    /**
     * Sends a per-card test for [channel] (web card `useTestChannel`). Tracks [testingChannelId] for the row
     * spinner and raises a name-prefixed [ChannelToast.TestSucceeded] / [ChannelToast.TestFailed] mirroring the
     * web `${ch.name}: …` toasts.
     */
    fun testFromCard(channel: NotificationChannel) {
        testingId.value = channel.id
        launch {
            try {
                source.testChannel(channel.id).fold(
                    onSuccess = { result -> emitToast(testToast(channel.name, result)) },
                    onFailure = { emitToast(ChannelToast.TestFailed(channel.name, null)) },
                )
            } finally {
                testingId.update { current -> current.takeIf { it != channel.id } }
            }
        }
    }

    /**
     * Creates or updates a channel (web modal `useSaveChannel`). Returns the [Result] so the modal closes on
     * success or shows the inline form error on failure (web `onSuccess` / `onError`). No toast — the web save
     * is silent. Restarts the reads on success so the new/edited card appears.
     */
    suspend fun save(input: NotificationChannelInput): Result<NotificationChannel> =
        source.saveChannel(input).onSuccess { refreshTrigger.update { it + 1 } }

    /**
     * Sends the modal's test for the channel [id] (web modal `useTestChannel`). Raises a name-less
     * [ChannelToast] (web `toast.success('Test sent!')`) AND returns the [Result] so the modal renders the inline
     * success/error banner.
     */
    suspend fun testFromModal(id: Long): Result<ChannelTestResult> {
        val result = source.testChannel(id)
        result.fold(
            onSuccess = { emitToast(testToast(null, it)) },
            onFailure = { emitToast(ChannelToast.TestFailed(null, null)) },
        )
        return result
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no channel name, id, or secret, so a diagnostics line can never leak what a user has configured.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNotificationChannelsViewOpened(logger)
    }

    private fun emitToast(toast: ChannelToast) {
        toastChannel.trySend(toast)
    }

    private fun testToast(
        channelName: String?,
        result: ChannelTestResult,
    ): ChannelToast =
        if (result.success) {
            ChannelToast.TestSucceeded(channelName)
        } else {
            ChannelToast.TestFailed(channelName, result.error)
        }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: NotificationChannelsViewSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { NotificationChannelsViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [NotificationsStore]. */
        fun create(
            store: NotificationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): NotificationChannelsViewModel = NotificationChannelsViewModel(notificationChannelsViewSource(store), logger, scope)

        /** Wire the surface from the shared **S7** [NotificationsRepository] (refetch-on-retry binding). */
        fun create(
            repository: NotificationsRepository,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): NotificationChannelsViewModel = NotificationChannelsViewModel(notificationChannelsViewSource(repository), logger, scope)
    }
}
