package io.teslasync.android.widgets

/**
 * The mutually-exclusive surface a widget renders, the at-a-glance analogue of the in-app
 * `UiPhase`. It encodes the ADR-013 freshness contract honestly: cached data is never painted as
 * live, and a stale/offline value is always labelled rather than blanked.
 *
 *  - [Loading]  — nothing cached yet and no background sync has completed (first install). A neutral
 *                 "open the app to load" hint, never a fake value.
 *  - [Content]  — cached data within its freshness window.
 *  - [Stale]    — cached data older than the freshness window, still shown but flagged stale.
 *  - [Offline]  — cached data shown because the last background refresh failed (last-known + retry).
 *  - [Empty]    — a load completed but there is nothing meaningful to show (e.g. no enrolled vehicle).
 *  - [Error]    — the last refresh failed and there is no cached value to fall back on.
 */
enum class WidgetRenderState {
    Loading,
    Content,
    Stale,
    Offline,
    Empty,
    Error,
}

/**
 * The outcome of the most recent background ([WidgetRefreshWorker]) refresh, persisted in the
 * widget's Glance preferences so the cache-only render path can tell an honest stale-vs-offline-vs-
 * error story without itself touching the network. It carries NO data and NO secrets — only the
 * coarse result.
 */
enum class WidgetSyncStatus {
    /** No background refresh has run yet this session, or none was recorded. */
    Unknown,

    /** The last refresh reached the network and updated the cache. */
    Ok,

    /** The last refresh failed but a cached value is still available (offline / last-known). */
    FailedWithCache,

    /** The last refresh failed and there is no cached value to show. */
    FailedNoCache,

    ;

    /** The stable token persisted to Glance preferences (decoded by [fromToken]). */
    val token: String get() = name

    companion object {
        /** Parses a persisted [token] back to a status, defaulting to [Unknown] for absent/garbled values. */
        fun fromToken(token: String?): WidgetSyncStatus = entries.firstOrNull { it.name == token } ?: Unknown
    }
}

/**
 * Derives the widget [WidgetRenderState] from the cache-read facts and the last background-sync
 * outcome — the single, fully-tested rule the cache/freshness adapter and every widget share.
 *
 * Precedence is deliberate and honest:
 *  1. no cached value → the failure (sync [WidgetSyncStatus.FailedNoCache]) shows [Error]; otherwise
 *     [Empty] when a load has happened ([WidgetSyncStatus.Ok]), else [Loading] (nothing yet).
 *  2. cached but structurally empty → [Empty] (e.g. an all-zero summary / no alerts).
 *  3. cached + last sync failed → [Offline] (last-known + retry), regardless of age.
 *  4. cached + past the freshness window → [Stale].
 *  5. otherwise → [Content].
 *
 * @param hasCachedValue whether a decodable cached value was read.
 * @param isContentEmpty whether that cached value is structurally empty for this domain.
 * @param isStale whether the cached value is older than its freshness window.
 * @param syncStatus the most recent background-refresh outcome.
 */
fun deriveRenderState(
    hasCachedValue: Boolean,
    isContentEmpty: Boolean,
    isStale: Boolean,
    syncStatus: WidgetSyncStatus,
): WidgetRenderState =
    when {
        !hasCachedValue ->
            when (syncStatus) {
                WidgetSyncStatus.FailedNoCache -> WidgetRenderState.Error
                WidgetSyncStatus.Ok -> WidgetRenderState.Empty
                else -> WidgetRenderState.Loading
            }

        isContentEmpty -> WidgetRenderState.Empty
        syncStatus == WidgetSyncStatus.FailedWithCache -> WidgetRenderState.Offline
        isStale -> WidgetRenderState.Stale
        else -> WidgetRenderState.Content
    }
