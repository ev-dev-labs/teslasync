package io.teslasync.shared.core.presentation.signals

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalsRepository
import io.teslasync.shared.core.data.repo.signalsAvailableKey
import io.teslasync.shared.core.data.repo.signalsHistoryKey
import io.teslasync.shared.core.data.repo.signalsLiveKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the typed signal-inspector surface — the cross-platform port of
 * the web `useSignals` hook domain (web/src/api/hooks/useSignals.ts). Every native Signals screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the three endpoints, their query keys, their `staleTime`/normalization, or the
 * `from`/`to`/`hours` history-window derivation.
 *
 * The three reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * `(feed, params)` is lazily created on first access, shared so every observer of the same params
 * folds into one upstream collection, and refreshable via the matching `refresh*` call. The domain
 * is READ-ONLY — the web hook file declares zero mutations — so the holder exposes no
 * mutation/invalidation API; the per-feed `refresh*` calls are the platform live-poll /
 * pull-to-refresh seam (the web `useLiveSignals` `refetchInterval` / `refetch()` analogue), and a
 * feed nobody observes is a no-op to refresh.
 *
 * The web hooks' `refetchInterval` cadence and their `enabled` lazy gates (`vehicleId > 0`,
 * `signalName` non-empty) are render-layer concerns and are intentionally NOT reproduced here: a
 * platform live-poll / pull-to-refresh drives re-collection, and the caller simply does not open a
 * feed until it has a valid vehicle/signal. The holder makes no network calls and performs no
 * normalization itself — it delegates entirely to the injected [SignalsRepository] (S7), which
 * carries the golden-locked ValueKind/UnitKind normalization. Values stay SI (Phase-42 stores
 * everything as SI); any display formatting is the render boundary's job (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SignalsStore(
    private val repo: SignalsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads (3) ----------------------------------------------------------------

    /**
     * Shared, refreshable `GET /signals/{vehicleId}/available` feed (web `useAvailableSignals`). The
     * same `vehicleId` always returns the same feed; bumping its trigger (via [refreshAvailableSignals])
     * restarts its cache-then-network collection.
     */
    public fun availableSignals(vehicleId: Long): StateFlow<Resource<AvailableSignalsResponse>> =
        feed(signalsAvailableKey(vehicleId)) { repo.availableSignals(vehicleId) }

    /**
     * Shared, refreshable `GET /signals/{vehicleId}/live` feed (web `useLiveSignals`). The web
     * `refetchInterval` (5s) is a render-layer concern; the platform drives re-collection via
     * [refreshLiveSignals].
     */
    public fun liveSignals(vehicleId: Long): StateFlow<Resource<LiveSignalsResponse>> =
        feed(signalsLiveKey(vehicleId)) { repo.liveSignals(vehicleId) }

    /**
     * Shared, refreshable `GET /signals/{vehicleId}/{signalName}/history` feed for [range]
     * (web `useSignalHistory`). The same `(vehicleId, signalName, range)` always returns the same
     * feed; refresh it via [refreshSignalHistory].
     */
    public fun signalHistory(
        vehicleId: Long,
        signalName: String,
        range: SignalHistoryRange = SignalHistoryRange(),
    ): StateFlow<Resource<SignalHistoryResponse>> =
        feed(signalsHistoryKey(vehicleId, signalName, range)) { repo.signalHistory(vehicleId, signalName, range) }

    // ---- Refreshes (the web `refetchInterval`/`refetch()` seam) --------------------

    /** Re-fetches the [availableSignals] feed for [vehicleId] if it is being observed. */
    public fun refreshAvailableSignals(vehicleId: Long): Unit = refresh(signalsAvailableKey(vehicleId))

    /** Re-fetches the [liveSignals] feed for [vehicleId] if it is being observed. */
    public fun refreshLiveSignals(vehicleId: Long): Unit = refresh(signalsLiveKey(vehicleId))

    /** Re-fetches the [signalHistory] feed for `(vehicleId, signalName, range)` if it is being observed. */
    public fun refreshSignalHistory(
        vehicleId: Long,
        signalName: String,
        range: SignalHistoryRange = SignalHistoryRange(),
    ): Unit = refresh(signalsHistoryKey(vehicleId, signalName, range))

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active. The heterogeneous
     * [feeds] map is keyed by the same stable per-feed string as the cache, so the cast back to the
     * caller's `T` is always sound (one key ⇒ one source type).
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        } as StateFlow<Resource<T>>

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
