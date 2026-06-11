package io.teslasync.android.data

/**
 * The mutually-exclusive surface a data-driven Compose screen renders. Mirrors the web
 * loading / empty / error / content contract (`Spinner` / `EmptyState` / `ErrorDisplay` /
 * content) that every parity page draws, and the Windows `LoadStatus` enum.
 */
enum class UiPhase {
    /** A first load is in flight and there is nothing cached to show yet — render a spinner/skeleton. */
    Loading,

    /** There is renderable content. */
    Content,

    /** The load succeeded (or cache replayed) but the payload is empty — render an empty state. */
    Empty,

    /** A hard failure with nothing cached to fall back on — render an error state with retry. */
    Error,
}

/**
 * The Android-side classification of a failure, derived from the shared
 * [io.teslasync.shared.core.net.ApiError] taxonomy. The render boundary maps this to a localized
 * message (ADR-014); it is never a user-facing string itself, so no PII can leak through it.
 */
enum class ErrorKind {
    Network,
    Timeout,
    Http,
    Decode,
    CircuitOpen,
    Unknown,
}

/**
 * The immutable, UI-thread-free state a page ViewModel exposes per data source — the lifecycle-aware
 * Compose projection of a shared-core cache-then-network [io.teslasync.shared.core.data.repo.Resource]
 * (ADR-013).
 *
 * It carries every state the ADR-013 freshness contract requires at once: the [data] to render
 * (cached immediately or fresh), whether a refresh is in flight over it ([refreshing]), the
 * [fetchedAt] freshness stamp, whether the value is [stale] (older than its TTL, or served from cache
 * because the network was unreachable — i.e. offline/"last known"), and the [errorKind] of any
 * failure. The derived flags below let a Composable switch surfaces without re-deriving the contract.
 *
 * Honest freshness: stale data is never presented as live — [stale] is always explicit, and a value
 * served from cache after a failed refresh keeps [data] visible while flagging both [stale] and
 * [errorKind] so the UI can show an "offline / last known" banner with a retry rather than blanking.
 *
 * @property phase the primary surface to render.
 * @property data the value to show (cached or fresh); `null` only on a first load or a hard error.
 * @property fetchedAt epoch-millisecond stamp of [data], or `null` when nothing has loaded.
 * @property stale whether [data] should be labeled stale/offline (never shown as live).
 * @property refreshing whether a network refresh is currently running over existing [data].
 * @property errorKind the classification of the most recent failure, or `null` when there is none.
 * @property httpStatus the HTTP status when [errorKind] is [ErrorKind.Http], else `null`.
 */
data class UiState<out T>(
    val phase: UiPhase,
    val data: T? = null,
    val fetchedAt: Long? = null,
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
) {
    /** True while a first load is in flight with nothing to show. */
    val isLoading: Boolean get() = phase == UiPhase.Loading

    /** True when there is renderable content. */
    val isContent: Boolean get() = phase == UiPhase.Content

    /** True when the payload is (or replayed) empty. */
    val isEmpty: Boolean get() = phase == UiPhase.Empty

    /** True when the primary surface is a hard error with no cached fallback. */
    val isError: Boolean get() = phase == UiPhase.Error

    /** True whenever a value is available to render, regardless of phase. */
    val hasData: Boolean get() = data != null

    /** True when the last load failed, even if cached data is still shown (offline). */
    val hasError: Boolean get() = errorKind != null

    /**
     * True when a retry affordance should be offered. Available for both a hard [isError] surface and
     * a stale/offline surface that is still showing cached [data] — so "last known + retry" works.
     */
    val canRetry: Boolean get() = errorKind != null

    /** True when cached [data] is being shown because the network was unreachable / it is stale. */
    val isOffline: Boolean get() = stale && data != null

    companion object {
        /** The initial, pre-collection state: a first load with nothing cached. */
        fun <T> loading(): UiState<T> = UiState(UiPhase.Loading)
    }
}
