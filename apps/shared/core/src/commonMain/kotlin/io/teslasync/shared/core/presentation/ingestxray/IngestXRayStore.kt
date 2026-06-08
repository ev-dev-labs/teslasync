package io.teslasync.shared.core.presentation.ingestxray

import io.teslasync.shared.core.data.repo.IngestXRayRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.ingestXRayKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Ingest X-Ray domain — the cross-platform port of the web
 * `useIngestXRay` hook (web/src/api/hooks/useIngestXRay.ts). Every native X-Ray screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoint, the query key, the param defaults, or the value-kind labelling.
 *
 * The lone read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013): each
 * `(vehicleId, window, bucket, limit)` feed is lazily created on first access, shared so every
 * observer of the same params folds into one upstream collection, and refreshable via [refresh].
 * There are no mutations — the web hook file contains only a single `useQuery` — so there is no
 * invalidation surface; refreshing simply re-collects the cache-then-network feed (which always
 * re-fetches while replaying the last cached value first, the web behaviour of keeping prior data
 * during a refetch).
 *
 * The web hook's `staleTime`/`refetchInterval` "live" poll cadence and its `enabled: numericId > 0`
 * lazy gate are render-layer concerns and are intentionally NOT reproduced here; a platform
 * pull-to-refresh / live-poll cadence drives re-collection. The `value_kind` labelling is the pure
 * [IngestXRayValueKinds.format] derivation, applied at the display boundary, not here. Values stay
 * SI (the X-Ray carries none anyway); the holder makes no network calls itself — it delegates
 * entirely to the injected [IngestXRayRepository] (S7). A feed nobody is observing is a no-op to
 * refresh.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class IngestXRayStore(
    private val repo: IngestXRayRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<IngestXRayResponse>>>()

    /**
     * Shared, refreshable `GET /system/ingest-xray/{vehicleId}` feed (web `useIngestXRay`). Cold
     * until first collected; every caller passing the same params receives the same shared instance.
     */
    public fun xray(
        vehicleId: Long,
        window: IngestXRayWindow = IngestXRayRepository.DEFAULT_WINDOW,
        bucket: IngestXRayBucket = IngestXRayRepository.DEFAULT_BUCKET,
        limit: Int = IngestXRayRepository.DEFAULT_LIMIT,
    ): StateFlow<Resource<IngestXRayResponse>> {
        val key = ingestXRayKey(vehicleId, window, bucket, limit)
        return feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.xray(vehicleId, window, bucket, limit) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }
    }

    /**
     * Re-fetches the X-Ray feed for the given params if it is being observed. Bumping the trigger
     * restarts the underlying cache-then-network collection; a no-op while nothing observes the feed
     * (the upstream is not running, so there is nothing to restart).
     */
    public fun refresh(
        vehicleId: Long,
        window: IngestXRayWindow = IngestXRayRepository.DEFAULT_WINDOW,
        bucket: IngestXRayBucket = IngestXRayRepository.DEFAULT_BUCKET,
        limit: Int = IngestXRayRepository.DEFAULT_LIMIT,
    ) {
        triggers[ingestXRayKey(vehicleId, window, bucket, limit)]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<IngestXRayResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
