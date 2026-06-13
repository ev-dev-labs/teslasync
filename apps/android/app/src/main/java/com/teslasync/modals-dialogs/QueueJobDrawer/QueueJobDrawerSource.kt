// The data port the QueueJobDrawer overlay binds to (P1/S8 state-holder seam) — the native analogue of
// the web component's single hook composition
// (web/src/api/hooks/useSystemQueues.ts `useQueueJobs` → web/src/features/admin/components/QueueJobDrawer.tsx).
// The view never performs HTTP itself; a shared adapter (the S8 SystemQueuesStore or the S7
// SystemQueuesRepository) or a test fake drives this. Cache-then-network freshness is preserved end to
// end (ADR-013): every read emission's cached/stale/error flags flow through unchanged so the
// view-model can render the full state matrix.
//
// The web drawer reads exactly one feed (`useQueueJobs`) and performs no mutations, so this seam is a
// single read plus the re-fetch trigger. It carries the web `enabled` gate verbatim: the per-worker
// jobs query only fetches when the drawer passes `enabled: true` AND a concrete worker is selected
// (web `enabled: open && worker && !testHookOverride`), reusing the shared, golden-locked
// [queueJobsEnabled] predicate so a closed drawer never burns a network call.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/modals-dialogs/QueueJobDrawer) cannot form a valid Kotlin package and the
// file hosts the seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.queuejobdrawer

import io.teslasync.shared.core.data.repo.QUEUE_JOBS_DEFAULT_LIMIT
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SystemQueuesRepository
import io.teslasync.shared.core.data.repo.queueJobsEnabled
import io.teslasync.shared.core.presentation.systemqueues.QueueJobsResponse
import io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The single seam the [QueueJobDrawerViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store or the network. [queueJobs] is the cache-then-network
 * per-worker job feed the web `useQueueJobs` serves, carrying the [enabled] gate; [refresh] is the
 * re-fetch trigger. No HTTP touches the view.
 */
interface QueueJobDrawerSource {
    /**
     * Stream the cache-then-network recent-jobs feed for [worker] (web `useQueueJobs`). [enabled]
     * carries the web `enabled` gate — a disabled or blank-[worker] read never fetches and stays at
     * the initial Loading slot (the analogue of a TanStack query with `enabled: false`). [limit]
     * mirrors the web hook's recent-jobs page size.
     */
    fun queueJobs(
        worker: String,
        enabled: Boolean,
        limit: Int = QUEUE_JOBS_DEFAULT_LIMIT,
    ): Flow<Resource<QueueJobsResponse>>

    /** Re-fetch [worker]'s jobs feed; a no-op for a binding whose read re-collection already re-fetches. */
    fun refresh(worker: String)
}

/**
 * Binds the surface to the shared **S8** [SystemQueuesStore] (web `useSystemQueues.ts`). The store owns
 * the shared per-worker `queueKeys.jobs(worker)` feed with its `enabled` gate and exposes a real
 * [SystemQueuesStore.refreshQueueJobs] re-fetch — so [refresh] forces a genuine reload (the web
 * `refetch()` while replaying the last cached rows first). No HTTP touches the view — the store (S7/S8)
 * owns it.
 */
fun queueJobDrawerSource(store: SystemQueuesStore): QueueJobDrawerSource =
    object : QueueJobDrawerSource {
        override fun queueJobs(
            worker: String,
            enabled: Boolean,
            limit: Int,
        ): Flow<Resource<QueueJobsResponse>> = store.queueJobs(worker, limit, enabled)

        override fun refresh(worker: String) = store.refreshQueueJobs(worker)
    }

/**
 * Binds the surface directly to the shared **S7** [SystemQueuesRepository]. Each [queueJobs] call with
 * an enabled, concrete worker starts a NEW cache-then-network collection, so the view-model's
 * refresh/retry trigger a genuine re-fetch (the web `refetch()` behaviour while replaying the last
 * cached rows first) and [refresh] is a no-op. A disabled or blank-worker read short-circuits to a
 * single Loading emission — the web `enabled: false` analogue — so a closed drawer never reaches the
 * network. Use this binding when a host does not share app-wide stores.
 */
fun queueJobDrawerSource(repository: SystemQueuesRepository): QueueJobDrawerSource =
    object : QueueJobDrawerSource {
        override fun queueJobs(
            worker: String,
            enabled: Boolean,
            limit: Int,
        ): Flow<Resource<QueueJobsResponse>> =
            if (queueJobsEnabled(worker, enabled)) {
                repository.queueJobs(worker, limit)
            } else {
                DISABLED_FEED
            }

        override fun refresh(worker: String) = Unit
    }

/** The disabled-query analogue: a single Loading slot with no cache, never reaching the network. */
private val DISABLED_FEED: Flow<Resource<QueueJobsResponse>> =
    flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))
