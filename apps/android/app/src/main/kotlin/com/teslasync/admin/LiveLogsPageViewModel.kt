// The state holder backing the LiveLogsPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + the `useLogStream` SSE hook (web/src/features/admin/pages/LiveLogsPage.tsx +
// web/src/api/hooks/useLogStream.ts). It owns the page's local interaction state (level/grep/grepDraft/
// vehicle/paused/autoscroll/enabled) as one immutable [LiveLogsInteraction] snapshot, manages the lifecycle
// of the shared KMP [LogStreamStore] (the cross-platform `useLogStream` port), and projects the live stream +
// interaction onto the render-ready [LiveLogsUiState] via the framework-free [projectLiveLogs].
//
// Lifecycle (web effect-restart parity): the live subscription is keyed by (level, grep, enabled,
// reconnectEpoch). A change to any of those re-mints the holder through [flatMapLatest] (tearing the old
// connection down) — exactly the web hook's effect re-running on `level`/`grep`/`enabled`. Pause and clear
// act on the LIVE holder without restarting it (web `paused` keeps the connection open while it stops
// appending; `clear` drops the buffer). The whole subscription is gated on UI observation via
// `WhileSubscribed`, so navigating away closes the stream — the web AbortController-on-unmount contract. All
// derivation lives in the model; this holder performs no HTTP and no SSE framing itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.livelogs

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel
import io.teslasync.shared.core.presentation.logstream.LogStreamState
import io.teslasync.shared.core.presentation.logstream.LogStreamStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * @param source the P1/S6 transport seam (real [io.teslasync.shared.core.net.sse.SseTransport] adapter ↔ test
 *   fake); the view never frames SSE itself.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + control events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveLogsPageViewModel(
    private val source: LiveLogsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(LiveLogsInteraction())

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<LiveLogsInteraction> = mutableInteraction.asStateFlow()

    // The live holder currently open, exposed only so [togglePause] / [clear] reach it without restarting the
    // connection. Written from the subscription coroutine, read from the main thread — a StateFlow is safe.
    private val storeRef = MutableStateFlow<LogStreamStore?>(null)

    private var viewOpenedRecorded = false

    /**
     * The render-ready surface as a lifecycle-aware [StateFlow]: the live [LogStreamState] folded with the
     * local interaction through [projectLiveLogs]. The stream is re-opened whenever the subscription key
     * (level / grep / enabled / reconnect epoch) changes, and is collected only while the screen observes
     * this flow (`WhileSubscribed`) — so leaving the page closes the connection (web unmount teardown).
     */
    val state: StateFlow<LiveLogsUiState> =
        combine(streamState(), mutableInteraction) { stream, interaction ->
            projectLiveLogs(stream, interaction)
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(SUBSCRIPTION_KEEPALIVE_MILLIS),
            initialValue = LiveLogsUiState.INITIAL,
        )

    // ── Filter setters ──────────────────────────────────────────────────────────────────────────────────────

    /** Sets the minimum severity (web `setLevel`); restarts the subscription with the new server filter. */
    fun setLevel(level: LogStreamLevel): Unit = mutableInteraction.update { it.copy(level = level) }

    /** Tracks the grep field text (web `setGrepDraft`), enforcing the web `maxLength = 256`. Does not restart. */
    fun setGrepDraft(text: String): Unit = mutableInteraction.update { it.copy(grepDraft = text.take(GREP_MAX_LENGTH)) }

    /** Commits the grep draft as the active server-side filter (web `applyGrep` on Enter/blur). Restarts. */
    fun applyGrep(): Unit = mutableInteraction.update { it.copy(grep = it.grepDraft) }

    /** Tracks the numeric client-side vehicle filter (web `setVehicleFilter`); applied to the current buffer. */
    fun setVehicleFilter(text: String): Unit = mutableInteraction.update { it.copy(vehicleFilter = text.trim()) }

    /** Toggles whether the table follows new events to the bottom (web `setAutoscroll`). */
    fun setAutoscroll(value: Boolean): Unit = mutableInteraction.update { it.copy(autoscroll = value) }

    // ── Stream controls ─────────────────────────────────────────────────────────────────────────────────────

    /**
     * Toggles the pause hold (web pause/resume). Pausing keeps the connection open but stops appending events;
     * it acts on the LIVE holder so the buffer freezes without dropping the stream.
     */
    fun togglePause() {
        val next = !mutableInteraction.value.paused
        mutableInteraction.update { it.copy(paused = next) }
        storeRef.value?.setPaused(next)
        logger.info("liveLogs.pauseToggle", mapOf("paused" to next.toString()))
    }

    /** Drops the in-memory buffer + counters on the live holder (web `clear`); the connection keeps running. */
    fun clear() {
        logger.info("liveLogs.clear")
        storeRef.value?.clear()
    }

    /** Re-opens the stream with a fresh connection (web reconnect: enabled false→true). */
    fun reconnect() {
        logger.info("liveLogs.reconnect")
        mutableInteraction.update { it.copy(enabled = true, reconnectEpoch = it.reconnectEpoch + 1) }
    }

    /** Retry affordance for the error surface — same as [reconnect]. */
    fun retry(): Unit = reconnect()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveLogsPageOpened(logger)
    }

    // ── Subscription lifecycle ──────────────────────────────────────────────────────────────────────────────

    /** The live [LogStreamState] feed, re-opened on every subscription-key change (web effect restart). */
    private fun streamState(): Flow<LogStreamState> =
        mutableInteraction
            .map { SubscriptionKey(it.level, it.grep, it.enabled, it.reconnectEpoch) }
            .distinctUntilChanged()
            .flatMapLatest { key -> openStream(key) }

    /**
     * Opens one live holder for [key] and emits its state, mirroring the web hook's effect body. A disabled
     * key emits a single disconnected snapshot and holds (web `enabled === false` short-circuit). On close
     * (key change or UI unsubscribe) the holder is stopped and the live reference cleared.
     */
    private fun openStream(key: SubscriptionKey): Flow<LogStreamState> =
        channelFlow {
            if (!key.enabled) {
                storeRef.value = null
                send(LogStreamState())
                awaitClose { }
                return@channelFlow
            }
            val store = source.logStream(key.level, key.grep, this)
            store.setPaused(mutableInteraction.value.paused)
            storeRef.value = store
            store.start()
            val pump = launch { store.state.collect { send(it) } }
            awaitClose {
                pump.cancel()
                store.stop()
                if (storeRef.value === store) storeRef.value = null
            }
        }

    /** The tuple that keys the live subscription; a change re-opens the stream (web hook effect deps). */
    private data class SubscriptionKey(
        val level: LogStreamLevel,
        val grep: String,
        val enabled: Boolean,
        val epoch: Int,
    )

    private companion object {
        /** Web `maxLength={256}` on the grep field. */
        const val GREP_MAX_LENGTH = 256

        /** Keep the live subscription alive briefly across config changes / fast re-subscribes. */
        const val SUBSCRIPTION_KEEPALIVE_MILLIS = 5_000L
    }
}
