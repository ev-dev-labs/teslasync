// UI-thread-free state holder backing the NotificationGroupRow feature view — the native analogue of the two
// data hooks the web component owns: the lazily-gated `useGroupMembers` thread fetch and the `useBulkMarkRead`
// "Mark group read" mutation (web/src/features/notifications/components/NotificationGroupRow.tsx +
// web/src/api/hooks/useNotifications.ts). It binds the shared Notifications control plane (P1/S8
// `NotificationsStore`) through [NotificationGroupRowSource]: the member feed is collected ONLY while the row
// is expanded (web `enabled: expanded && !isSingleton`), and the mutation routes through the store's
// `bulkMarkRead({ group_key })`. The view performs no HTTP — it collects [membersState] / [expanded] /
// [markPending] and calls [toggleExpanded] / [markGroupRead] / [refresh] / [recordViewOpened].
//
// It is a plain holder (not an AndroidX ViewModel): the surface is a row inside a virtualized list, so its
// state is owned per-row and torn down with the row's composition scope — which also matches the web `useState`
// expansion that resets when a virtualized row unmounts. It takes an injected [CoroutineScope] (the composable
// passes `rememberCoroutineScope()`; tests pass a `TestScope` background scope), exactly like the sibling
// view-models' test seam.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationGroupRow) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located source seam + adapters.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationgrouprow

import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationLogGroup
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.notifications.UpdatedCountResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The i18n catalog key for the mark-group-read success toast (web `group.markReadSuccess`). */
internal const val MARK_READ_SUCCESS_KEY: String = "notifications.group.markReadSuccess"

/** The i18n catalog key for the mark-group-read failure toast (web `group.markReadError`). */
internal const val MARK_READ_ERROR_KEY: String = "notifications.group.markReadError"

/**
 * The data port the row binds to — the native analogue of the web `useGroupMembers` + `useBulkMarkRead` hooks.
 * A concrete adapter over the shared Notifications layer (or a test fake) drives this seam; the view never
 * performs HTTP.
 */
interface NotificationGroupRowSource {
    /** The cache-then-network thread-members feed (web `useGroupMembers`), reusing the parent inbox filters. */
    fun groupMembers(
        groupKey: String,
        filters: NotificationFilters,
    ): Flow<Resource<List<NotificationLog>>>

    /** Marks every member of [groupKey] read via the backend's group path (web `useBulkMarkRead`). */
    suspend fun markGroupRead(groupKey: String): Result<UpdatedCountResult>
}

/**
 * Binds the row to the shared **S8** [NotificationsStore] — the memoized, multi-observer feed every Notifications
 * surface shares. The member feed folds into the same shared collection as the parent inbox, and `markGroupRead`
 * routes through the store so it refreshes the whole notification-log family on success (web `invalidateQueries`).
 */
fun NotificationsStore.asNotificationGroupRowSource(): NotificationGroupRowSource {
    val store = this
    return object : NotificationGroupRowSource {
        override fun groupMembers(
            groupKey: String,
            filters: NotificationFilters,
        ): Flow<Resource<List<NotificationLog>>> = store.groupMembers(groupKey, filters)

        override suspend fun markGroupRead(groupKey: String): Result<UpdatedCountResult> =
            store.bulkMarkRead(BulkMarkReadVars.Group(groupKey))
    }
}

/**
 * Binds the row directly to the shared **S7** [NotificationsRepository] — the cold cache-then-network `Flow`.
 * Use when a host wants the row to own an isolated member fetch rather than fold into the shared store feed.
 */
fun NotificationsRepository.asNotificationGroupRowSource(): NotificationGroupRowSource {
    val repo = this
    return object : NotificationGroupRowSource {
        override fun groupMembers(
            groupKey: String,
            filters: NotificationFilters,
        ): Flow<Resource<List<NotificationLog>>> = repo.groupMembers(groupKey, filters)

        override suspend fun markGroupRead(groupKey: String): Result<UpdatedCountResult> =
            repo.bulkMarkRead(BulkMarkReadVars.Group(groupKey))
    }
}

/**
 * Per-row state holder for a notification group thread.
 *
 * @param source the cache-then-network Notifications seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param group the host-owned group; only its `group_key` (the thread identity + singleton guard) is read here.
 * @param filters the parent inbox's filters, reused so the thread fetch mirrors the same window (web parity).
 * @param scope the scope shared feeds run in + the mutation launches on — the composable's `rememberCoroutineScope()`
 *   in production, a `TestScope` background scope in tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationGroupRowPresenter(
    private val source: NotificationGroupRowSource,
    private val logger: Logger,
    group: NotificationLogGroup,
    private val filters: NotificationFilters,
    private val scope: CoroutineScope,
) {
    private val groupKey: String? = group.groupKey
    private val isSingleton: Boolean = groupKey == null

    private val expandedState = MutableStateFlow(false)

    /** Whether the thread is expanded (web `expanded` state). Singleton groups can never expand. */
    val expanded: StateFlow<Boolean> = expandedState

    private val refreshTrigger = MutableStateFlow(0)
    private val markPendingState = MutableStateFlow(false)

    /** Whether the mark-group-read mutation is in flight (web `bulkMarkRead.isPending`), disabling its action. */
    val markPending: StateFlow<Boolean> = markPendingState

    private val eventChannel = Channel<UiEvent>(Channel.BUFFERED)

    /** One-shot toast effects raised by the mark-group-read mutation (web `useToast`). Never replayed. */
    val events: Flow<UiEvent> = eventChannel.receiveAsFlow()

    private var viewOpenedRecorded = false

    /**
     * The thread-members surface as a lifecycle-aware [StateFlow]. While collapsed (or for a singleton) it holds
     * the neutral empty state and NEVER opens the feed — the native analogue of the web disabled-query gate
     * (`enabled: expanded && !isSingleton`). On expand it collects the cache-then-network member feed and
     * projects it onto a [UiState] carrying loading / content / empty / stale / offline / error.
     */
    val membersState: StateFlow<UiState<List<NotificationLog>>> =
        combine(expandedState, refreshTrigger) { exp, _ -> exp }
            .flatMapLatest { exp -> membersFeed(exp) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Toggles the expanded thread (web `setExpanded((v) => !v)`). A no-op for a singleton group. */
    fun toggleExpanded() {
        if (isSingleton) return
        expandedState.update { !it }
    }

    /** Re-runs the member fetch (the freshness auto-refresh + the hard-error retry). */
    fun refresh() {
        logger.info("notificationGroupRow.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Marks the whole thread read (web `handleMarkGroupRead`): routes the group-key mutation through the shared
     * layer, then raises a success toast carrying the updated count or an error toast — as localized i18n keys
     * (ADR-014), never pre-formatted sentences. A no-op for a singleton (no group key) or while already pending.
     */
    fun markGroupRead() {
        val gk = groupKey ?: return
        if (markPendingState.value) return
        markPendingState.value = true
        scope.launch {
            source
                .markGroupRead(gk)
                .onSuccess { eventChannel.trySend(successMessage(it)) }
                .onFailure { eventChannel.trySend(ERROR_MESSAGE) }
            markPendingState.value = false
        }
    }

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNotificationGroupRowOpened(logger)
    }

    private fun membersFeed(isExpanded: Boolean): Flow<UiState<List<NotificationLog>>> {
        val gk = groupKey
        return if (isExpanded && !isSingleton && gk != null) {
            source.groupMembers(gk, filters).map { it.toUiState() }
        } else {
            flowOf(IDLE_MEMBERS)
        }
    }

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L

        /** The collapsed/singleton idle value; the region is never rendered while it is held. */
        val IDLE_MEMBERS: UiState<List<NotificationLog>> = UiState(UiPhase.Empty, emptyList())

        /** The localized-key error toast (web `toast.error('group.markReadError')`). */
        val ERROR_MESSAGE: UiEvent.Message = UiEvent.Message(MARK_READ_ERROR_KEY, severity = UiEvent.Severity.Error)

        /** The localized-key success toast carrying the updated count (web `t('group.markReadSuccess', { count })`). */
        fun successMessage(result: UpdatedCountResult): UiEvent.Message =
            UiEvent.Message(
                messageKey = MARK_READ_SUCCESS_KEY,
                args = listOf(result.updated.toString()),
                severity = UiEvent.Severity.Success,
            )
    }
}
