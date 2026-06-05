package io.teslasync.shared.core.presentation.featureflags

import io.teslasync.shared.core.data.repo.FEATURE_FLAG_CHANGES_DEFAULT_LIMIT
import io.teslasync.shared.core.data.repo.FeatureFlagsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.flagCacheKey
import io.teslasync.shared.core.data.repo.flagChangesCacheKey
import io.teslasync.shared.core.data.repo.flagsListCacheKey
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
 * UI-free shared state holder for the typed feature-flag registry — the cross-platform port of the
 * web `useFeatureFlags` hook domain (web/src/api/hooks/useFeatureFlags.ts). Every native
 * Feature-Flags screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, the change-feed scoping rule, or the
 * invalidate-all rule.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, params)` folds into
 * one upstream collection, and refreshable.
 *  - [flags] mirrors the web `useFlags` (the full registry);
 *  - [flag] mirrors the web `useFlag` (a single flag, post-save refresh of the edit drawer);
 *  - [flagChanges] mirrors the web `useFlagChanges` (the global feed, or one flag's history when a
 *    non-blank `flagKey` is supplied).
 *
 * Mutations are sudo-gated, non-throwing suspend [Result]s; on success each refreshes EVERY
 * observed feed via [refreshAll], because the web hooks invalidate the `['system','flags']` prefix
 * (a set/delete can affect the list, any per-key entry, and any change feed at once). The
 * repository (S7) clears the whole cache partition on the same success, so each refresh re-fetches
 * rather than replaying a stale entry. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class FeatureFlagsStore(
    private val repo: FeatureFlagsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads (3) ----------------------------------------------------------------

    /** Shared, refreshable `GET /system/flags` feed — the full registry (web `useFlags`). */
    public fun flags(): StateFlow<Resource<FeatureFlagsListResponse>> = feed(flagsListCacheKey()) { repo.flags() }

    /**
     * Shared, refreshable `GET /system/flags/{key}` feed for [key] (web `useFlag`). The web hook is
     * `enabled` only for a non-blank key; this requires a non-blank [key] (the UI gates the call).
     */
    public fun flag(key: String): StateFlow<Resource<FeatureFlagEntry>> {
        require(key.isNotEmpty()) { "flag(key) requires a non-blank key (web useFlag is disabled for an empty key)" }
        return feed(flagCacheKey(key)) { repo.flag(key) }
    }

    /**
     * Shared, refreshable flag-change audit feed (web `useFlagChanges`). A non-blank [flagKey]
     * scopes to one flag's history; null/blank lists the global feed across every flag. [limit]
     * defaults to the web `PAGINATION.DEFAULT_LIMIT` (50).
     */
    public fun flagChanges(
        flagKey: String? = null,
        limit: Int = FEATURE_FLAG_CHANGES_DEFAULT_LIMIT,
    ): StateFlow<Resource<FeatureFlagChangesResponse>> = feed(flagChangesCacheKey(flagKey, limit)) { repo.flagChanges(flagKey, limit) }

    // ---- Mutations (2) ------------------------------------------------------------

    /**
     * Creates or updates a flag (sudo-gated; web `useSetFlag`), then refreshes EVERY observed feed
     * — the `invalidateQueries(['system','flags'])` analogue, because the new value and its audit
     * row can surface in the list, the per-key entry, and any change feed.
     */
    public suspend fun setFlag(
        key: String,
        value: JsonElement,
        reason: String,
    ): Result<FeatureFlagWriteResponse> = repo.setFlag(key, value, reason).onSuccess { refreshAll() }

    /**
     * Deletes a flag (sudo-gated; web `useDeleteFlag`), then refreshes EVERY observed feed. `reason`
     * is required by the backend (the audit row is rejected without it).
     */
    public suspend fun deleteFlag(
        key: String,
        reason: String,
    ): Result<FeatureFlagWriteResponse> = repo.deleteFlag(key, reason).onSuccess { refreshAll() }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating the
     * `['system','flags']` prefix. Bumping a feed's trigger restarts its cache-then-network
     * collection; a feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { it.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refreshAll]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active. The feed map is
     * heterogeneously typed (list / entry / changes), so the cast is guarded by the one-to-one
     * key→source pairing above.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        } as StateFlow<Resource<T>>

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
