package io.teslasync.shared.core.presentation.system

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SYSTEM_RATE_LIMITS_KEY
import io.teslasync.shared.core.data.repo.SystemRepository
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
 * UI-free shared state holder for the System surface — the cross-platform port of the web
 * `useSystem` hook domain (web/src/api/hooks/useSystem.ts). Every native System screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoint, its query key, or its caching intent.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013):
 * lazily created on first access, shared so every observer of the feed folds into one upstream
 * collection, and refreshable via [refreshRateLimitStatus]. The domain is READ-ONLY — the web hook
 * file declares zero mutations — so the holder exposes no mutation/invalidation API; the
 * `refresh*` call is the platform pull-to-refresh / live-poll seam (the web `refetchInterval`
 * analogue), and a feed nobody observes is a no-op to refresh.
 *
 * The web hook's `refetchInterval` (30s) and its visibility-paused polling
 * (`refetchIntervalInBackground:false`) are render-layer concerns and are intentionally NOT
 * reproduced here; a platform live-poll cadence drives re-collection, and
 * [SharingStarted.WhileSubscribed] already suspends the upstream when nothing observes it (the
 * pause-on-hidden analogue). The holder makes no network calls itself — it delegates entirely to
 * the injected [SystemRepository] (S7). Values stay SI (the budget rows carry none anyway); any
 * display formatting is the render boundary's job (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed is routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SystemStore(
    private val repo: SystemRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads (1) ----------------------------------------------------------------

    /** Shared, refreshable `GET /system/rate-limits` feed (web `useRateLimitStatus`). */
    public fun rateLimitStatus(): StateFlow<Resource<RateLimitStatusResponse>> = feed(SYSTEM_RATE_LIMITS_KEY) { repo.rateLimitStatus() }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [rateLimitStatus] feed if it is being observed; a no-op otherwise. */
    public fun refreshRateLimitStatus(): Unit = refresh(SYSTEM_RATE_LIMITS_KEY)

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active. The
     * heterogeneous [feeds] map is keyed by the same stable per-feed string as the cache, so the
     * cast back to the caller's `T` is always sound (one key ⇒ one source type).
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

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
