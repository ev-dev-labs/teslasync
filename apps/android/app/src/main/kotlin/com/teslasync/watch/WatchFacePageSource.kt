// The data seam the WatchFacePage wearable surface binds to, plus its production binding over the shared-core
// Watch repository (P1/S7). The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's two primitives
// (web/src/features/watch/pages/WatchFacePage.tsx over web/src/api/hooks/useWatch.ts):
// `useWatchSummary(vehicleId)` (`GET /watch/summary`, cache-then-network) and `useWatchCommand`
// (`POST /watch/command`).
//
// The reads/commands route through the shared-core [WatchRepository] — the cross-platform S7 port every native
// Watch surface (the dashboard WatchSummaryWidget, the Apple/Windows ports) already shares — so the cache keys,
// the optional `vehicle_id` parameter, the per-feed staleness window and the command body shape are defined
// once. The production binding constructs an [HttpWatchRepository] over the SAME resilient [ApiHttpClient] +
// offline [CacheStore] the rest of the Android DI graph uses (mirroring the sibling CommandsPageHost, which
// likewise builds a page-local repository from `container.api` + `container.cacheStore`). A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete client or the network.
//
// The web `useWatch` file authenticates these calls with an `X-API-Key`/`skipAuthRefresh` transport instead of
// the cookie/OAuth flow; that networking-layer (S4/S6) detail is wired at the platform boundary, not reproduced
// here — exactly as the shared [WatchRepository] documents.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/watch) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.watch.watchface

import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.data.repo.HttpWatchRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.WatchRepository
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.watch.WatchCommandResult
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [WatchFacePageViewModel] depends on so it binds to an abstraction (the shared resilient
 * Watch repository in production, a fake in tests), never to a concrete client or the network. The summary read
 * is the page's cache-then-network `Resource` feed (web `useWatchSummary`); the command is the page's one
 * mutation (web `useWatchCommand`). No HTTP touches the view.
 */
interface WatchFacePageSource {
    /**
     * The `GET /watch/summary` glance feed for [vehicleId] (web `useWatchSummary`), surfaced as a
     * cache-then-network [Resource] stream: [Resource.Loading] first, then a terminal [Resource.Success] (the
     * full glance payload) or [Resource.Error], with the freshness flags preserved. A null [vehicleId] reads
     * the primary vehicle (the endpoint omits `vehicle_id`), mirroring the web `vehicleId ? … : undefined`.
     */
    fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>>

    /**
     * Dispatches a watch-issued command (web `useWatchCommand`): `POST /watch/command` `{ vehicle_id, command }`.
     * Returns a non-throwing [Result]; the backend may answer `2xx` with [WatchCommandResult.success] = `false`
     * for a rejected command. Mirroring the web mutation, success invalidates no feed (its `onSuccess` only
     * raises a toast). [vehicleId] defaults to `0` on the wire when null (the web `vehicleId ?? 0`).
     */
    suspend fun sendWatchCommand(
        vehicleId: Long?,
        command: String,
    ): Result<WatchCommandResult>
}

/**
 * Binds the surface to a page-local [HttpWatchRepository] over the shared resilient [api] + offline [cacheStore]
 * — the same resilient client + cache every repository runs on, so the freshness/offline contract is identical.
 * The summary feed flows through unchanged so the view-model renders the full state matrix (loading / content /
 * empty / error / stale / offline); the command returns the backend outcome verbatim. No HTTP touches the view.
 */
fun watchFacePageSourceOf(
    api: ApiHttpClient,
    cacheStore: CacheStore,
): WatchFacePageSource = WatchRepositorySource(HttpWatchRepository(api, cacheStore))

/** Adapts any shared-core [WatchRepository] (the real HTTP one in production, a fake in tests) to the seam. */
private class WatchRepositorySource(
    private val repo: WatchRepository,
) : WatchFacePageSource {
    override fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>> = repo.watchSummary(vehicleId)

    override suspend fun sendWatchCommand(
        vehicleId: Long?,
        command: String,
    ): Result<WatchCommandResult> = repo.sendWatchCommand(vehicleId, command)
}
