package io.teslasync.shared.core.presentation.anomalies

import io.teslasync.shared.core.data.repo.AnomaliesRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the signal-anomaly read-model — the cross-platform port of the
 * web `useAnomalies` hook domain (web/src/api/hooks/useAnomalies.ts). Every native Anomalies screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoint, query key, refetch rule, or the disabled-query gate.
 *
 * The lone read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013): it is
 * lazily created on first access, shared so every observer of the same `(vehicleId, days)` folds
 * into one upstream collection, and refreshable via [refreshAnomalies]. There are no mutations —
 * the web hook file contains only a `useQuery` — so there is no invalidation surface here.
 *
 * The web hook gates the query with `enabled: vehicleId !== null`. The holder reproduces that gate:
 * when [vehicleId] is null the returned feed never fetches and stays at the initial Loading slot
 * (the analogue of a TanStack query with `enabled: false`), so a screen can bind before a vehicle
 * is selected. All such disabled feeds collapse to one stable instance keyed by `days`, so the UI
 * binds once and the repository is never touched.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected
 * [AnomaliesRepository] (S7). Values stay SI; conversion is display-only (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed is routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AnomaliesStore(
    private val repo: AnomaliesRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()
    private val disabledFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    /**
     * Shared, refreshable `GET /analytics/anomalies?vehicle_id={vehicleId}&days={days}` feed
     * (web `useAnomalies`, default 7 days). When [vehicleId] is null the returned feed never
     * fetches and stays at the initial Loading slot — the analogue of `enabled: vehicleId !== null`.
     */
    public fun anomalies(
        vehicleId: String?,
        days: Int = 7,
    ): StateFlow<Resource<JsonElement>> {
        if (vehicleId == null) return disabledFeeds.getOrPut("$days") { MutableStateFlow(INITIAL) }
        return feed(key(vehicleId, days)) { repo.anomalies(vehicleId, days) }
    }

    /**
     * Re-fetches the [anomalies] feed for [vehicleId]/[days] if it is being observed. A no-op for a
     * null [vehicleId] (whose feed never fetches) or a feed nobody has opened.
     */
    public fun refreshAnomalies(
        vehicleId: String?,
        days: Int = 7,
    ) {
        if (vehicleId == null) return
        refresh(key(vehicleId, days))
    }

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun key(
            vehicleId: String,
            days: Int,
        ): String = "$vehicleId:$days"
    }
}
