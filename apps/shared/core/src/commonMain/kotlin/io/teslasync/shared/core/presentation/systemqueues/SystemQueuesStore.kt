package io.teslasync.shared.core.presentation.systemqueues

import io.teslasync.shared.core.data.repo.QUEUE_JOBS_DEFAULT_LIMIT
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SYSTEM_QUEUES_STATUS_KEY
import io.teslasync.shared.core.data.repo.SystemQueuesRepository
import io.teslasync.shared.core.data.repo.queueJobsCacheKey
import io.teslasync.shared.core.data.repo.queueJobsEnabled
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
 * UI-free shared state holder for the worker job-queue surface — the cross-platform port of the web
 * `useSystemQueues` hook domain (web/src/api/hooks/useSystemQueues.ts). Every native SystemQueues
 * screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoints, their query keys, the drawer `enabled` gate, or the caching intent.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same feed (or the same worker)
 * folds into one upstream collection, and refreshable via the `refresh*` seam. [queueStatus] mirrors
 * the web `useQueueStatus` (`GET /system/queues`); [queueJobs] mirrors the web `useQueueJobs`
 * (`GET /system/queues/{worker}/jobs`) with its `enabled` gate — when [enabled] is false or [worker]
 * is blank the returned feed never fetches and stays at the initial Loading slot (the analogue of a
 * TanStack query with `enabled: false`), collapsing to one stable disabled instance so a closed
 * drawer can bind before a worker is selected.
 *
 * The domain is READ-ONLY — the web hook file declares zero mutations — so the holder exposes no
 * mutation/invalidation API; the `refresh*` calls are the platform pull-to-refresh / live-poll seam
 * (the web `refetchInterval` analogue: 30s status / 60s jobs), and a feed nobody observes is a no-op
 * to refresh. The web hooks' visibility-paused polling (`refetchIntervalInBackground:false`) is a
 * render-layer concern and is intentionally NOT reproduced here; a platform live-poll cadence drives
 * re-collection, and [SharingStarted.WhileSubscribed] already suspends the upstream when nothing
 * observes it (the pause-on-hidden analogue). The holder makes no network calls itself — it delegates
 * entirely to the injected [SystemQueuesRepository] (S7). Values stay SI; conversion is display-only
 * (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised; create
 * and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SystemQueuesStore(
    private val repo: SystemQueuesRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val statusFeeds = mutableMapOf<String, StateFlow<Resource<QueueStatusResponse>>>()
    private val jobsFeeds = mutableMapOf<String, StateFlow<Resource<QueueJobsResponse>>>()
    private val disabledJobsFeed: StateFlow<Resource<QueueJobsResponse>> = MutableStateFlow(INITIAL_JOBS)

    // ---- Reads (2) ----------------------------------------------------------------

    /** Shared, refreshable `GET /system/queues` feed (web `useQueueStatus`). */
    public fun queueStatus(): StateFlow<Resource<QueueStatusResponse>> =
        sharedFeed(SYSTEM_QUEUES_STATUS_KEY, statusFeeds, INITIAL_STATUS) { repo.queueStatus() }

    /**
     * Shared, refreshable `GET /system/queues/{worker}/jobs` feed (web `useQueueJobs`). When
     * [enabled] is false or [worker] is blank the returned feed never fetches and stays at the
     * initial Loading slot — the analogue of the web `enabled` gate — collapsing to one stable
     * disabled instance so a closed drawer can bind before a worker is selected. The feed is keyed by
     * worker alone (web `queueKeys.jobs(worker)`); [limit] is a refetch arg, mirroring the web hook's
     * default of [QUEUE_JOBS_DEFAULT_LIMIT].
     */
    public fun queueJobs(
        worker: String,
        limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
        enabled: Boolean = true,
    ): StateFlow<Resource<QueueJobsResponse>> {
        if (!queueJobsEnabled(worker, enabled)) return disabledJobsFeed
        return sharedFeed(queueJobsCacheKey(worker), jobsFeeds, INITIAL_JOBS) { repo.queueJobs(worker, limit) }
    }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [queueStatus] feed if it is being observed; a no-op otherwise. */
    public fun refreshQueueStatus(): Unit = refresh(SYSTEM_QUEUES_STATUS_KEY)

    /** Re-fetches the [queueJobs] feed for [worker] if it is being observed; a no-op otherwise. */
    public fun refreshQueueJobs(worker: String): Unit = refresh(queueJobsCacheKey(worker))

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access into [feeds]. The feed is
     * a `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun <T> sharedFeed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        initial: Resource<T>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = initial,
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
        val INITIAL_STATUS: Resource<QueueStatusResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_JOBS: Resource<QueueJobsResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
