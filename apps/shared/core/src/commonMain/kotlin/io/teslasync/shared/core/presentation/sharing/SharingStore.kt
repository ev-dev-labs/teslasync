package io.teslasync.shared.core.presentation.sharing

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SharingRepository
import io.teslasync.shared.core.data.repo.shareLinksCacheKey
import io.teslasync.shared.core.data.repo.sharedDriveCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the shareable-drive-reports surface — the cross-platform port of
 * the web `useSharing` hook domain (web/src/api/hooks/useSharing.ts). Every native Sharing screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, or the per-drive invalidation rule.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 *  - [shareLinks] mirrors the web `useShareLinks(driveId)` — one shared, refreshable feed per
 *    drive, lazily created on first access and shared so every observer of the same drive folds
 *    into one upstream collection. It is the single feed the mutations refresh.
 *  - [sharedDrive] mirrors the web `useSharedDrive(token)` — the PUBLIC report behind a share
 *    token, one shared feed per token. It carries NO invalidation trigger: the web mutations never
 *    invalidate `sharingKeys.shared`, so neither does this feed.
 *
 * Mutations are non-throwing suspend [Result]s; on success each refreshes ONLY the affected drive's
 * share-link feed ([refreshShareLinks]), exactly as the web `useCreateShareLink` /
 * `useRevokeShareLink` mutations invalidate ONLY `sharingKeys.shares(driveId)` (never the public
 * report, never another drive's links). A failed mutation refreshes nothing (the web `onError`
 * skips invalidation). The repository (S7) evicts that same drive key on the same success, so each
 * refresh re-fetches rather than replaying a stale entry. Toasts are a render-layer concern (web
 * `useToast`) and are intentionally NOT reproduced here. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SharingStore(
    private val repo: SharingRepository,
    private val scope: CoroutineScope,
) {
    private val shareLinkTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val shareLinkFeeds = mutableMapOf<String, StateFlow<Resource<List<ShareToken>>>>()
    private val sharedDriveFeeds = mutableMapOf<String, StateFlow<Resource<SharedDrive>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /drives/{driveId}/shares` feed for [driveId] (web `useShareLinks`).
     * The same `driveId` always returns the same feed; bumping its trigger (via
     * [refreshShareLinks]) restarts its cache-then-network collection.
     */
    public fun shareLinks(driveId: String): StateFlow<Resource<List<ShareToken>>> {
        val key = shareLinksCacheKey(driveId)
        return shareLinkFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.shareLinks(driveId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = SHARE_LINKS_INITIAL,
                )
        }
    }

    /**
     * Shared `GET /share/{token}` feed for the public report behind [token] (web `useSharedDrive`).
     * The same `token` always returns the same feed. It carries no invalidation trigger because the
     * web mutations never invalidate the public report query.
     */
    public fun sharedDrive(token: String): StateFlow<Resource<SharedDrive>> {
        val key = sharedDriveCacheKey(token)
        return sharedDriveFeeds.getOrPut(key) {
            repo
                .sharedDrive(token)
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = SHARED_DRIVE_INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Creates a share link for [driveId], then refreshes that drive's share-link feed on success
     * (web `useCreateShareLink`, which invalidates `sharingKeys.shares(driveId)`). A failed create
     * refreshes nothing.
     */
    public suspend fun createShareLink(
        driveId: String,
        request: CreateShareRequest,
    ): Result<CreateShareResponse> = repo.createShareLink(driveId, request).onSuccess { refreshShareLinks(driveId) }

    /**
     * Revokes the share link [token] owned by [driveId], then refreshes that drive's share-link feed
     * on success (web `useRevokeShareLink`, which invalidates `sharingKeys.shares(driveId)`). A
     * failed revoke refreshes nothing.
     */
    public suspend fun revokeShareLink(
        driveId: String,
        token: String,
    ): Result<Unit> = repo.revokeShareLink(driveId, token).onSuccess { refreshShareLinks(driveId) }

    /**
     * Re-fetches the share-link feed for [driveId] — the holder-side analogue of invalidating
     * `sharingKeys.shares(driveId)`. Bumping the drive's trigger restarts its cache-then-network
     * collection. A drive nobody is observing is a no-op.
     */
    public fun refreshShareLinks(driveId: String) {
        shareLinkTriggers[shareLinksCacheKey(driveId)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = shareLinkTriggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val SHARE_LINKS_INITIAL: Resource<List<ShareToken>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val SHARED_DRIVE_INITIAL: Resource<SharedDrive> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
