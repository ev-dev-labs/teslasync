package io.teslasync.shared.core.presentation.aiusage

import io.teslasync.shared.core.data.repo.AiUsageRepository
import io.teslasync.shared.core.data.repo.Resource
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
 * UI-free shared state holder for the AI-usage audit feeds — the cross-platform port of the
 * web `useAiUsage` hook domain (web/src/api/hooks/useAiUsage.ts). Every native AI-usage screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, or refetch rules.
 *
 * The three reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * each is lazily created on first access, shared so every observer of the same `(feed, params)`
 * folds into one upstream collection, and refreshable via [refresh]. There are no mutations —
 * the web hook file contains only `useQuery`s — so there is no invalidation surface here. The
 * holder makes no network calls itself; it delegates entirely to the injected
 * [AiUsageRepository] (S7).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AiUsageStore(
    private val repo: AiUsageRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    /** Shared, refreshable `GET /ai/usage/today` feed. */
    public fun today(): StateFlow<Resource<JsonElement>> = feed(KEY_TODAY) { repo.today() }

    /** Shared, refreshable `GET /ai/usage/by-feature` feed for [since] (null ⇒ server default 7d). */
    public fun byFeature(since: String? = null): StateFlow<Resource<JsonElement>> =
        feed("$KEY_BY_FEATURE:${since ?: ""}") { repo.byFeature(since) }

    /** Shared, refreshable `GET /ai/usage/recent` feed for [limit] (null ⇒ server default 50). */
    public fun recent(limit: Int? = null): StateFlow<Resource<JsonElement>> = feed("$KEY_RECENT:${limit ?: 0}") { repo.recent(limit) }

    /** Re-fetches the `today` feed if it is being observed. */
    public fun refreshToday(): Unit = refresh(KEY_TODAY)

    /** Re-fetches the `by-feature` feed for [since] if it is being observed. */
    public fun refreshByFeature(since: String? = null): Unit = refresh("$KEY_BY_FEATURE:${since ?: ""}")

    /** Re-fetches the `recent` feed for [limit] if it is being observed. */
    public fun refreshRecent(limit: Int? = null): Unit = refresh("$KEY_RECENT:${limit ?: 0}")

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
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
        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        const val KEY_TODAY = "today"
        const val KEY_BY_FEATURE = "by-feature"
        const val KEY_RECENT = "recent"
    }
}
