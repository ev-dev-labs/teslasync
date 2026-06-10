package io.teslasync.shared.core.presentation.watch

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.WatchRepository
import io.teslasync.shared.core.data.repo.watchComplicationCacheKey
import io.teslasync.shared.core.data.repo.watchSummaryCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Watch surface — the cross-platform port of the web `useWatch` hook
 * domain (web/src/api/hooks/useWatch.ts). Every native Watch screen (Android/Apple via KMP, Windows via
 * the C# port) binds to this single holder rather than re-implementing the endpoints, the cache keys,
 * the optional `vehicle_id` parameter, or the command body shape.
 *
 * The two reads are each exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013),
 * scoped to one (optional) vehicle and lazily created on first access, then shared so every observer of
 * the same vehicle folds into one upstream collection:
 *  - [watchSummary] mirrors the web `useWatchSummary(vehicleId)` — the full glance payload.
 *  - [watchComplication] mirrors the web `useWatchComplication(vehicleId)` — the minimal complication.
 *
 * The one command is a non-throwing suspend [Result], mirroring the web mutation exactly:
 *  - [sendWatchCommand] mirrors `useWatchCommand`: it POSTs `{ vehicle_id, command }` and returns the
 *    backend's [WatchCommandResult] verbatim. The web mutation invalidates NOTHING on success (its
 *    `onSuccess` only raises a toast), so this command refreshes no feed and fires no hook. The
 *    success/error toast is a render-layer concern and is intentionally NOT reproduced here.
 *
 * Each read can be re-collected on demand via [refreshSummary]/[refreshComplication] — the holder-side
 * analogue of a TanStack `invalidateQueries`, used by the platform's poll cadence (the web reads
 * auto-refresh via `refetchInterval`; that timer lives in the platform layer, not here). The holder
 * makes no network calls itself and is not internally synchronised; create and drive it from one
 * confinement (the platform main scope), mirroring the web hook's single-threaded usage.
 *
 * @property repo the S7 data port the two feeds and the command are routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class WatchStore(
    private val repo: WatchRepository,
    private val scope: CoroutineScope,
) {
    private val summaryTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val summaryFeeds = mutableMapOf<String, StateFlow<Resource<WatchSummary>>>()
    private val complicationTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val complicationFeeds = mutableMapOf<String, StateFlow<Resource<WatchComplication>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /watch/summary` feed for [vehicleId] (web `useWatchSummary`). The same
     * [vehicleId] always returns the same feed; bumping its trigger (via [refreshSummary]) restarts its
     * cache-then-network collection. A null [vehicleId] is its own ("primary vehicle") feed.
     */
    public fun watchSummary(vehicleId: Long? = null): StateFlow<Resource<WatchSummary>> {
        val key = watchSummaryCacheKey(vehicleId)
        return summaryFeeds.getOrPut(key) {
            trigger(summaryTriggers, key)
                .flatMapLatest { repo.watchSummary(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = summaryInitial(),
                )
        }
    }

    /**
     * Shared, refreshable `GET /watch/complication` feed for [vehicleId] (web `useWatchComplication`).
     * The same [vehicleId] always returns the same feed; bumping its trigger (via [refreshComplication])
     * restarts its cache-then-network collection.
     */
    public fun watchComplication(vehicleId: Long? = null): StateFlow<Resource<WatchComplication>> {
        val key = watchComplicationCacheKey(vehicleId)
        return complicationFeeds.getOrPut(key) {
            trigger(complicationTriggers, key)
                .flatMapLatest { repo.watchComplication(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = complicationInitial(),
                )
        }
    }

    // ---- Command ------------------------------------------------------------------

    /**
     * Dispatches a watch-issued command (web `useWatchCommand`), returning the backend's
     * [WatchCommandResult] verbatim. [vehicleId] defaults to `0` on the wire when null (the web
     * `vehicleId ?? 0`). Mirroring the web mutation, success refreshes no feed and fires no hook (its
     * `onSuccess` only raises a toast, a render concern); the caller inspects
     * [WatchCommandResult.success] to surface the outcome.
     */
    public suspend fun sendWatchCommand(
        command: String,
        vehicleId: Long? = null,
    ): Result<WatchCommandResult> = repo.sendWatchCommand(vehicleId, command)

    // ---- Refresh (invalidation analogue) ------------------------------------------

    /**
     * Re-fetches the summary feed for [vehicleId] — the holder-side analogue of the web `refetchInterval`
     * tick / `invalidateQueries(watchKeys.summary(id))`. A vehicle nobody is observing is a no-op.
     */
    public fun refreshSummary(vehicleId: Long? = null) {
        summaryTriggers[watchSummaryCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    /**
     * Re-fetches the complication feed for [vehicleId] — the holder-side analogue of the web
     * `refetchInterval` tick / `invalidateQueries(watchKeys.complication(id))`. A vehicle nobody is
     * observing is a no-op.
     */
    public fun refreshComplication(vehicleId: Long? = null) {
        complicationTriggers[watchComplicationCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(
        triggers: MutableMap<String, MutableStateFlow<Int>>,
        key: String,
    ): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        fun summaryInitial(): Resource<WatchSummary> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun complicationInitial(): Resource<WatchComplication> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
