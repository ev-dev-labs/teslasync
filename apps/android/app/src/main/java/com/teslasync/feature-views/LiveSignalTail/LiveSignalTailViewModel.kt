// UI-thread-free state holder backing the LiveSignalTail feature view — the native port of the
// `useLiveSignalStream` SSE tail the web parent owns and passes down as `entries`/`rate`/`paused`
// (web/src/features/telemetry/components/LiveSignalTail.tsx + web/src/features/telemetry/hooks/
// useLiveSignalStream.ts). It binds the shared live pipeline (P1/S8) through [LiveSignalTailSource]: it
// collects the selected vehicle's merged live signals from the app-scoped `LiveSessionStore` (ADR-009, the
// single SSE stream) and folds successive merged-state deltas into a capped, newest-first tail buffer with a
// 1 Hz signals/sec rate — the native adaptation of the web event firehose, since the single-stream mandate
// forbids opening a second subscription. The view never performs HTTP — it only collects [state] and calls
// [togglePause] / [clear] / [retry] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveSignalTail) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignaltail

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.live.LiveSessionStore
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * One projected emission of the shared live pipeline for the selected vehicle — the seam the tail folds. It
 * carries the vehicle's merged signal map plus the wire health, so the view-model can both diff the firehose
 * and surface connection/staleness, all without the view touching HTTP or the `SseClient` directly.
 *
 * @property vehicleId the selected vehicle (web parent's picker); `null`/non-positive holds the empty tail.
 * @property signals the merged latest signal values (web `useVehicleLive` merge), keyed by Tesla field name.
 * @property lastUpdatedMillis the client clock of the vehicle's most recent merge (stamps derived rows).
 * @property status the wire health (web `connected`): Connected / Reconnecting / Disconnected / Unknown.
 * @property isStale whether the open stream has gone silent past the freshness window (ADR-013).
 * @property lastMessageAtMillis the last live message of any kind, for the freshness chip.
 */
@Suppress("LongParameterList") // One field per piece of the shared LiveSessionState the tail projects.
data class LiveSignalTailFrame(
    val vehicleId: Long?,
    val signals: Map<String, JsonElement>,
    val lastUpdatedMillis: Long?,
    val status: LiveConnectionStatus,
    val isStale: Boolean,
    val lastMessageAtMillis: Long?,
)

/**
 * The data port the tail binds to — the native analogue of the web `useLiveSignalStream` subscription. A
 * concrete adapter over the shared live pipeline (or a test fake) drives this seam; the view never performs
 * HTTP. [reconnect] backs the user retry affordance (web parent's reconnect), forwarding to the shared
 * stream so a stuck/offline wire reopens with a refreshed credential.
 */
interface LiveSignalTailSource {
    /** The selected vehicle's live merged-signal feed (web `useLiveSignalStream` over the SSE stream). */
    fun frames(): Flow<LiveSignalTailFrame>

    /** Forces a fresh connection (web parent's reconnect / the freshness + error retry). */
    fun reconnect()
}

/**
 * Binds the tail to the shared **S8** live pipeline: the app-scoped [LiveSessionStore] (the single SSE
 * stream, ADR-009) projected onto the [selection]'s active vehicle. Collecting the feed opens the gated
 * subscription (foreground + auth + observed); [reconnect] forwards to the store. No HTTP touches the view.
 */
fun liveSignalTailSource(
    store: LiveSessionStore,
    selection: SelectedVehicleStore,
): LiveSignalTailSource =
    object : LiveSignalTailSource {
        override fun frames(): Flow<LiveSignalTailFrame> =
            combine(store.state, selection.selectedId) { session, id ->
                val vehicle = session.vehicle(id)
                LiveSignalTailFrame(
                    vehicleId = id,
                    signals = vehicle.signals,
                    lastUpdatedMillis = vehicle.lastUpdatedMillis,
                    status = session.status,
                    isStale = session.isStale,
                    lastMessageAtMillis = session.lastMessageAtMillis,
                )
            }

        override fun reconnect() = store.reconnect()
    }

/**
 * @param source the live-pipeline seam (a shared-data-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only collects + folds the feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + control events.
 * @param bufferMax the tail buffer cap (web `tailMax`, default [DEFAULT_BUFFER_MAX]); shown in the stat.
 * @param nowMillis client clock for receipt stamps + the rate window; injectable for deterministic tests.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class LiveSignalTailViewModel(
    private val source: LiveSignalTailSource,
    logger: Logger,
    private val bufferMax: Int = DEFAULT_BUFFER_MAX,
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val paused = MutableStateFlow(false)
    private val clearTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The projected tail surface as a lifecycle-aware [StateFlow]. The accumulator folds the firehose +
     * pause/clear; a 1 Hz ticker re-projects the rate so it decays as a quiet stream's receipts age out of
     * the window. Equal states are conflated by the [StateFlow], so an idle stream stops re-emitting.
     */
    val state: StateFlow<LiveSignalTailState> =
        combine(source.frames(), paused, clearTrigger) { frame, isPaused, clearEpoch ->
            ReduceInput(frame, isPaused, clearEpoch)
        }.scan(Accum.SEED) { acc, input -> reduce(acc, input) }
            .combine(rateTicker()) { acc, now -> acc.toState(bufferMax, now) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LiveSignalTailState.initial(bufferMax),
            )

    /** Toggles the controlled pause flag (web `onPauseToggle`); paused drops incoming rows, never the wire. */
    fun togglePause() {
        paused.update { !it }
        logger.info("liveSignalTail.pauseToggle", mapOf("paused" to paused.value.toString()))
    }

    /** Empties the tail buffer (web `onClear` / `clearTail`); the stream keeps running. */
    fun clear() {
        logger.info("liveSignalTail.clear")
        clearTrigger.update { it + 1 }
    }

    /** Re-opens the live stream (web parent's reconnect + the freshness/error retry). */
    fun retry() {
        logger.info("liveSignalTail.retry")
        source.reconnect()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no signal name or value, so a diagnostics line can never leak the vehicle's live
     * state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveSignalTailOpened(logger)
    }

    /**
     * Folds one [input] into the accumulator. A first frame, a vehicle switch, or a clear resets the buffer
     * and re-baselines [Accum.prevSignals] to the current snapshot (so the initial merged dump is never
     * replayed as a flood — only subsequent changes become rows). Otherwise the scalar signals that changed
     * since the last frame become rows (dropped while paused), and the snapshot is always advanced so a
     * resume shows only post-resume changes (web pause drops events).
     */
    private fun reduce(
        acc: Accum,
        input: ReduceInput,
    ): Accum {
        val frame = input.frame
        val resetNeeded = !acc.seeded || acc.vehicleId != frame.vehicleId || acc.clearEpoch != input.clearEpoch
        if (resetNeeded) {
            return Accum(
                entries = emptyList(),
                nextId = 0L,
                prevSignals = frame.signals,
                vehicleId = frame.vehicleId,
                seeded = true,
                paused = input.paused,
                status = frame.status,
                isStale = frame.isStale,
                updatedAtMillis = frame.lastMessageAtMillis,
                clearEpoch = input.clearEpoch,
            )
        }
        val stamp = frame.lastUpdatedMillis ?: nowMillis()
        val incoming =
            if (input.paused) {
                emptyList()
            } else {
                LiveSignalTailProjection.diffToEntries(acc.prevSignals, frame.signals, acc.nextId, stamp)
            }
        return acc.copy(
            entries = LiveSignalTailProjection.appendCapped(acc.entries, incoming, bufferMax),
            nextId = acc.nextId + incoming.size,
            prevSignals = frame.signals,
            paused = input.paused,
            status = frame.status,
            isStale = frame.isStale,
            updatedAtMillis = frame.lastMessageAtMillis ?: acc.updatedAtMillis,
        )
    }

    /** A 1 Hz-ish clock pulse so the rate decays even when no frame arrives (web 1 s `setInterval`). */
    private fun rateTicker(): Flow<Long> =
        flow {
            while (true) {
                emit(nowMillis())
                delay(RATE_REFRESH_MILLIS)
            }
        }

    /** The combined upstream tuple folded by [reduce]. */
    private data class ReduceInput(
        val frame: LiveSignalTailFrame,
        val paused: Boolean,
        val clearEpoch: Int,
    )

    /**
     * The internal fold accumulator: the buffered [entries], the next sequence [nextId], the previous
     * [prevSignals] snapshot the next diff runs against, the active [vehicleId] (switch → reset), whether a
     * baseline frame has been [seeded], and the carried wire/freshness fields the projected state surfaces.
     */
    @Suppress("LongParameterList") // Internal fold state: render fields + the diff bookkeeping.
    private data class Accum(
        val entries: List<LiveSignalEntry>,
        val nextId: Long,
        val prevSignals: Map<String, JsonElement>,
        val vehicleId: Long?,
        val seeded: Boolean,
        val paused: Boolean,
        val status: LiveConnectionStatus,
        val isStale: Boolean,
        val updatedAtMillis: Long?,
        val clearEpoch: Int,
    ) {
        fun toState(
            bufferMax: Int,
            now: Long,
        ): LiveSignalTailState =
            LiveSignalTailState(
                entries = entries,
                rate = LiveSignalTailProjection.ratePerSecond(entries, now),
                paused = paused,
                bufferMax = bufferMax,
                status = status,
                isStale = isStale,
                updatedAtMillis = updatedAtMillis,
            )

        companion object {
            /** Pre-subscription seed: empty, unseeded, neutral wire (web cold start before any frame). */
            val SEED: Accum =
                Accum(
                    entries = emptyList(),
                    nextId = 0L,
                    prevSignals = emptyMap(),
                    vehicleId = null,
                    seeded = false,
                    paused = false,
                    status = LiveConnectionStatus.Unknown,
                    isStale = false,
                    updatedAtMillis = null,
                    clearEpoch = 0,
                )
        }
    }

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L

        /** Rate re-projection cadence; sub-second so the decay to 0 tracks the 1 s window closely. */
        const val RATE_REFRESH_MILLIS = 500L
    }
}
