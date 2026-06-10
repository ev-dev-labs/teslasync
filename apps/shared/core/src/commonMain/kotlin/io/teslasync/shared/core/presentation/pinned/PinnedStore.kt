package io.teslasync.shared.core.presentation.pinned

import io.teslasync.shared.core.data.repo.PinnedRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.pinnedCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the unified pin store — the cross-platform port of the web
 * `usePinned` hook domain (web/src/api/hooks/usePinned.ts). Every native surface that floats
 * pinned rows to the top (vehicle picker, dashboard widgets, alerts, geofences, automations,
 * commands) binds to this single holder rather than re-implementing endpoints, query keys, the
 * pin/unpin row-id lookup, or the invalidate granularity.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 *  - [pinned] mirrors the web `usePinned(type, context?)` — one shared, refreshable feed per
 *    `(type, context)` bucket, lazily created on first access and shared so every observer of the
 *    same bucket folds into one upstream collection.
 *
 * Mutations are non-throwing suspend [Result]s; on success they refresh feeds at the SAME
 * granularity the web hooks invalidate at:
 *  - [togglePin] mirrors `useTogglePin(type)` — POST to pin, or resolve-then-DELETE to unpin;
 *    on success it refreshes EVERY observed feed ([refreshAll]) because the web invalidates
 *    `pinnedKeys.all` (`['pinned']`). The unpin path resolves the existing row id from the cached
 *    bucket ([PinnedRepository.peekPinned]) with a fresh-fetch fallback
 *    ([PinnedRepository.fetchPinned]), exactly as the web mutationFn reads `getQueryData` then
 *    falls back to `await request(...)`. A successful unpin that finds no matching row is still a
 *    success that refreshes (the web returns `null` and still runs `onSuccess`); a failed
 *    fetch/POST/DELETE is propagated and refreshes nothing (the web `onError` skips invalidation).
 *  - [reorderPin] mirrors `useReorderPin(type)` — PATCH the position; on success it refreshes
 *    ONLY the `(type, no-context)` feed ([refreshType]) because the web invalidates
 *    `pinnedKeys.list(type)` = `['pinned', type, null]`, whose partial-match touches ONLY the
 *    null-context query (a `['pinned', type, 'ctx']` feed does not match `null` at index 2).
 *
 * The holder makes no network calls itself. It mirrors the web hook's single-threaded usage and
 * is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class PinnedStore(
    private val repo: PinnedRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<List<PinnedItem>>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /pinned?type=&context=` feed for the `(type, context)` bucket (web
     * `usePinned`). The same `(type, context)` returns the SAME feed instance; distinct buckets
     * get distinct feeds, keyed by [pinnedCacheKey].
     */
    public fun pinned(
        type: PinnedItemType,
        context: String? = null,
    ): StateFlow<Resource<List<PinnedItem>>> {
        val key = pinnedCacheKey(type, context)
        return feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.pinned(type, context) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Pins ([pin] = true) or unpins ([pin] = false) a single item, then refreshes every observed
     * feed on success (web `useTogglePin`, which invalidates `pinnedKeys.all`). Pinning POSTs the
     * new row; unpinning resolves the existing row id from the cached bucket — falling back to a
     * fresh fetch when the cache is cold — and DELETEs it. A no-op unpin (no matching row) still
     * succeeds and refreshes; any network failure is propagated and refreshes nothing.
     */
    public suspend fun togglePin(
        type: PinnedItemType,
        itemId: String,
        pin: Boolean,
        context: String? = null,
    ): Result<PinnedItem?> {
        val outcome: Result<PinnedItem?> =
            if (pin) {
                repo.createPin(type, itemId, context)
            } else {
                resolveAndUnpin(type, itemId, context)
            }
        return outcome.onSuccess { refreshAll() }
    }

    /**
     * Reorders a single pin within its bucket, then refreshes ONLY the `(type, no-context)` feed
     * on success (web `useReorderPin`, which invalidates `pinnedKeys.list(type)`).
     */
    public suspend fun reorderPin(
        type: PinnedItemType,
        id: Long,
        position: Int,
    ): Result<PinnedItem> = repo.reorderPin(id, position).onSuccess { refreshType(type) }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating `pinnedKeys.all`.
     * A feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { it.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Resolves the existing pin row for `(type, context)` matching [itemId] and DELETEs it (the
     * web unpin path). The cached bucket is consulted first; on a miss OR a cold cache a fresh
     * fetch is issued (the web `cached?.find(...) ?? (await request(...)).find(...)`). A failed
     * fallback fetch is propagated unchanged. A resolved-to-nothing lookup is a successful no-op
     * (the web `if (!existing) return null`).
     */
    private suspend fun resolveAndUnpin(
        type: PinnedItemType,
        itemId: String,
        context: String?,
    ): Result<PinnedItem?> {
        val cachedHit = repo.peekPinned(type, context)?.firstOrNull { it.itemId == itemId }
        val existing =
            cachedHit ?: run {
                val fetched = repo.fetchPinned(type, context)
                fetched.fold(
                    onSuccess = { rows -> rows.firstOrNull { it.itemId == itemId } },
                    onFailure = { return Result.failure(it) },
                )
            }
        return if (existing == null) {
            Result.success(null)
        } else {
            repo.deletePin(existing.id).map { null }
        }
    }

    /**
     * Bumps the `(type, no-context)` feed's trigger to restart its cache-then-network collection —
     * the partial-match of the web `invalidateQueries(pinnedKeys.list(type))`, which touches ONLY
     * the `['pinned', type, null]` query. A `(type, context)` feed is deliberately left untouched,
     * exactly as the web filter (`null` at index 2) excludes it. A feed nobody observes is a no-op.
     */
    private fun refreshType(type: PinnedItemType) {
        triggers[pinnedCacheKey(type, null)]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<List<PinnedItem>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
