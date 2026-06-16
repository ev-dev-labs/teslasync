// The data seam the SystemPage admin surface binds to for the worker-queue feed it hosts, plus its
// production binding over the shared S8 SystemQueuesStore. The view (composable) performs NO HTTP — it only
// collects state from the page ViewModel, which drives this seam, reproducing the embedded QueueStatusPanel's
// single `useQueueStatus` read (`GET /system/queues`). The rate-limit feed has its own self-fetching panel
// overload (RateLimitStatusPanel(systemStore)), so it is not routed through this seam.
//
// The read is the shared-core cache-then-network `Resource` stream the S8 SystemQueuesStore already exposes
// (queueStatus()); [refresh] is the store's own per-feed re-fetch (the web `refetchInterval` / error-retry
// analogue). A narrow seam so the ViewModel depends on an abstraction (real adapter ↔ test fake), never on a
// concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.system

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import io.teslasync.shared.core.presentation.systemqueues.SystemQueuesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [SystemPageViewModel] depends on so it binds to an abstraction (the shared
 * SystemQueues holder in production, a fake in tests), never to a concrete store or the network. The read is
 * a cache-then-network typed `Resource` flow (web `useQueueStatus`); [refresh] re-fetches it (the web query
 * `refetch` / the error-state retry). No HTTP touches the view.
 */
interface SystemPageSource {
    /** The typed `GET /system/queues` feed (web `useQueueStatus`). */
    fun queueStatus(): Flow<Resource<QueueStatusResponse>>

    /** Re-fetches the worker-queue feed (web `refetch` / error retry). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [SystemQueuesStore] — the memoized, multi-observer queue-status feed
 * the app shares. The live values flow through unchanged so the ViewModel renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun SystemQueuesStore.asSystemPageSource(): SystemPageSource {
    val store = this
    return object : SystemPageSource {
        override fun queueStatus(): Flow<Resource<QueueStatusResponse>> = store.queueStatus()

        override fun refresh() = store.refreshQueueStatus()
    }
}
