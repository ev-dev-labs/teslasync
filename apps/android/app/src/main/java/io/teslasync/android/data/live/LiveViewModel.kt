package io.teslasync.android.data.live

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * Page ViewModel that projects the app-scoped [LiveSessionStore] onto lifecycle-aware streams every
 * live screen binds to (ADR-009) — the Android counterpart of the web `useLiveConnection` +
 * `useVehicleLive` pair. It owns no networking and no token code: the store (and the shared `SseClient`
 * under it) handle the connection, reconnect, staleness, and re-auth.
 *
 * Because each stream is re-shared with `WhileSubscribed`, the underlying SSE subscription is held only
 * while a screen actually observes one of these flows (via `collectAsStateWithLifecycle`), and dropped
 * a short timeout after the screen leaves — composing with the store's app-foreground + auth gates so
 * the stream is open exactly when foreground live data is needed.
 *
 * @param store the app-scoped live pipeline holder.
 * @param selection the app-wide active-vehicle selection (the [vehicle] stream tracks it).
 * @param logger the single sanctioned redacting logger (ADR-016).
 */
class LiveViewModel(
    private val store: LiveSessionStore,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** Live-wire health for `LiveIndicator` (Connected / Reconnecting / Disconnected / Unknown). */
    val status: StateFlow<LiveConnectionStatus> =
        store.state
            .map { it.status }
            .reshare(store.state.value.status)

    /** True when the open stream has gone stale past the 2-minute window — drives `LiveStaleDataBanner`. */
    val isStale: StateFlow<Boolean> =
        store.state
            .map { it.isStale }
            .reshare(store.state.value.isStale)

    /** Client clock of the last live message of any kind, for the indicator's "updated Xs ago" chip. */
    val lastMessageAtMillis: StateFlow<Long?> =
        store.state
            .map { it.lastMessageAtMillis }
            .reshare(store.state.value.lastMessageAtMillis)

    /**
     * The active vehicle's always-complete merged live state — empty (never null) before the first
     * frame, so a panel renders an empty-state surface instead of blanking. Switches as the selection
     * changes.
     */
    val vehicle: StateFlow<LiveVehicleState> =
        combine(store.state, selection.selectedId) { session, id -> session.vehicle(id) }
            .reshare(store.state.value.vehicle(selection.selectedId.value))

    /** User-initiated reconnect (retry button): forces a fresh connection and a credential refresh. */
    fun retry() {
        logger.info("live.retry")
        store.reconnect()
    }

    private fun <T> kotlinx.coroutines.flow.Flow<T>.reshare(initial: T): StateFlow<T> =
        stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), initial)
}
