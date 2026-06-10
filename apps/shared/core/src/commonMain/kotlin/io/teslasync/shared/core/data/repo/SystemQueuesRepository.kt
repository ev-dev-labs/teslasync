package io.teslasync.shared.core.data.repo

import io.ktor.http.encodeURLPathPart
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import kotlinx.coroutines.flow.Flow

/** Cache/feed key for [SystemQueuesRepository.queueStatus] — web `queueKeys.status`. */
public const val SYSTEM_QUEUES_STATUS_KEY: String = "status"

/** Web `QUEUE_STATUS_STALE_TIME_MS` — the status feed's freshness window (15s). */
public const val QUEUE_STATUS_STALE_TIME_MS: Long = 15_000L

/** Web `QUEUE_JOBS_STALE_TIME_MS` — the per-worker jobs feed's freshness window (30s). */
public const val QUEUE_JOBS_STALE_TIME_MS: Long = 30_000L

/** Web `QUEUE_JOBS_DEFAULT_LIMIT` — recent-jobs page size (clamped to [1,200] server-side). */
public const val QUEUE_JOBS_DEFAULT_LIMIT: Int = 25

/**
 * The S7 data port for the worker job-queue surface — the cross-platform analogue of the web
 * `useSystemQueues` hook domain (web/src/api/hooks/useSystemQueues.ts), mounted under
 * `/api/v1/system/queues…`. Every native SystemQueues screen (Android/Apple via KMP, Windows via the
 * C# port) reaches the backend exclusively through this interface, so a single fake stands in for
 * the whole domain in the S8 state-holder tests.
 *
 * The domain is READ-ONLY — `useSystemQueues.ts` contains exactly two `useQuery`s (`useQueueStatus`,
 * `useQueueJobs`) and zero mutations — so both reads stream a cache-then-network [Resource]
 * (ADR-013): the cached value first for an instant cold start, then the refreshed value. There is no
 * invalidation surface because there is nothing to mutate (logout clears the partition).
 *
 * The two reads carry different web `staleTime`s (status 15s, jobs 30s); the HTTP implementation
 * overrides the jobs feed's TTL per-read so each flags staleness on its own web-faithful threshold.
 * The web hooks' `refetchInterval` (30s / 60s) and visibility-paused polling
 * (`refetchIntervalInBackground:false`) are render-layer concerns and are NOT reproduced here — a
 * platform live-poll / pull-to-refresh cadence drives re-collection (the S8 store's `refresh*`
 * seam). Payloads are counts, second-based ages, and millisecond durations — not display-unit-
 * bearing — so they round-trip verbatim with no SI conversion.
 */
public interface SystemQueuesRepository {
    /**
     * `GET /system/queues` → [QueueStatusResponse] (web `useQueueStatus`). Streams the cached worker
     * snapshot first, then the refreshed one; a transport failure surfaces as [Resource.Error]
     * serving the cached value (stale) rather than throwing across the flow.
     */
    public fun queueStatus(): Flow<Resource<QueueStatusResponse>>

    /**
     * `GET /system/queues/{worker}/jobs?limit={limit}` → [QueueJobsResponse] (web `useQueueJobs`).
     * The [worker] is percent-encoded into the path exactly as the web `encodeURIComponent(worker)`
     * does; [limit] mirrors the server-side query param (web default [QUEUE_JOBS_DEFAULT_LIMIT]).
     * Cached under [queueJobsCacheKey], mirroring the web `queueKeys.jobs(worker)` tuple — keyed by
     * worker alone, exactly as the web query key omits the limit. Callers must not pass a blank
     * worker (the S8 store gates that as a disabled query, the web `enabled` analogue).
     */
    public fun queueJobs(
        worker: String,
        limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
    ): Flow<Resource<QueueJobsResponse>>
}

/**
 * The `enabled` gate ported from the web `useQueueJobs` drawer hook: the per-worker jobs query only
 * fetches when the drawer passes `enabled: true` AND a concrete worker is selected. A blank/whitespace
 * worker — the analogue of no drawer target — keeps the query disabled regardless of [enabled]. Pure
 * and language-neutral so the C# port mirrors it exactly (golden-locked, ADR-004).
 */
public fun queueJobsEnabled(
    worker: String,
    enabled: Boolean,
): Boolean = enabled && worker.isNotBlank()

/**
 * The per-worker jobs cache/feed key ported from the web `queueKeys.jobs(worker)` tuple
 * (`['system','queues','jobs',worker]`): keyed by [worker] alone — the limit is a refetch arg, not
 * part of the web query key, so two limits for the same worker share one cache slot exactly as the
 * web shares one query. Prefixed `jobs:` so it can never collide with [SYSTEM_QUEUES_STATUS_KEY] in
 * the shared partition. Pure and golden-locked for cross-platform parity (ADR-004).
 */
public fun queueJobsCacheKey(worker: String): String = "jobs:$worker"

/**
 * The per-worker jobs path ported from the web `useQueueJobs`
 * (`/system/queues/${encodeURIComponent(worker)}/jobs`). The [worker] segment is percent-encoded via
 * [encodeURLPathPart] so a worker id with URL-unsafe characters reaches the wire byte-identically to
 * the web `encodeURIComponent(worker)`; the `limit` is carried as a query parameter, not embedded
 * here, so the path is a pure function of [worker]. Golden-locked for cross-platform parity (ADR-004).
 */
public fun queueJobsPath(worker: String): String = "/system/queues/${worker.encodeURLPathPart()}/jobs"
