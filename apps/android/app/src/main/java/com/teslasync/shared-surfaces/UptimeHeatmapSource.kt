// The data seam the UptimeHeatmap surface binds to for its single data source — the native analogue of the
// web component's `days` prop (web/src/components/status/UptimeHeatmap.tsx). The web surface is purely
// presentational: its caller supplies the rolling window (some callers synthesize it — today = current
// status, prior days = healthy by default — until day-by-day health history is available). The native port
// keeps the same contract: the view (composable) performs NO HTTP and never holds the window itself — it
// only collects state from the [UptimeHeatmapViewModel], which drives this seam (ADR-002). A host feeds the
// window into the shared [UptimeHeatmapStore]; a test fake or an in-memory source backs it in tests/previews.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UptimeHeatmap) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `UptimeHeatmap*` filename hosts the
// `UptimeHeatmapSource` seam plus its co-located shared store + adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.uptimeheatmap

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The seam the [UptimeHeatmapViewModel] depends on so it binds to an abstraction (a host-fed store ↔ a test
 * fake), never a concrete client — the Android counterpart of the web component's `days` prop. The window is
 * carried as a cache-then-network [Resource] feed (ADR-013) so the surface's loading/content/empty/error/
 * stale/offline matrix folds out of the same contract every other surface uses. No HTTP touches the view.
 */
interface UptimeHeatmapSource {
    /** The rolling-window feed (the native `days` prop): loading → resolved, with freshness. */
    fun window(): Flow<Resource<UptimeWindow>>

    /**
     * Requests a refresh of the window — marks the cached window as refreshing (stale) so the freshness chip
     * shows while the host re-feeds it, or resets to a first-load when there is nothing cached. Backs the
     * surface's retry/auto-refresh affordances.
     */
    fun refresh()
}

/**
 * The shared, multi-observer window store — the native holder a host feeds the rolling window into (the web
 * `days` prop / the synthesized window). A single instance is shared by every observer so a window pushed
 * anywhere refreshes the heatmap everywhere.
 *
 * The feed starts [Resource.Loading] (pre-feed). [submit] resolves it to [Resource.Success]; [fail] resolves
 * it to [Resource.Error] (offline/last-known when a prior window exists, a hard error otherwise);
 * [beginRefresh] flags a refresh over the cached window (stale) until the next [submit]. The store performs
 * NO networking — it is the boundary between the host's data pipeline and the surface.
 *
 * @param clock injectable time source for the freshness stamp; tests pass a fixed clock.
 */
class UptimeHeatmapStore(
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val feed =
        MutableStateFlow<Resource<UptimeWindow>>(
            Resource.Loading(cached = null, fetchedAt = null, stale = false),
        )

    /** The reactive window feed shared by every observer. */
    fun window(): StateFlow<Resource<UptimeWindow>> = feed.asStateFlow()

    /** Resolves the feed to a fresh [window] (the host fed a new rolling window). */
    fun submit(window: UptimeWindow) {
        feed.value = Resource.Success(window, fetchedAt = clock(), stale = false)
    }

    /**
     * Resolves the feed to a failure. A prior cached window is kept and flagged stale (offline/last-known);
     * with no cache the feed becomes a hard error (the surface's error branch + retry).
     */
    fun fail(error: Throwable) {
        val current = feed.value.cached
        feed.value =
            Resource.Error(
                cached = current,
                fetchedAt = if (current != null) clock() else null,
                stale = current != null,
                error = error,
            )
    }

    /** Flags a refresh over the cached window (stale) until the next [submit]; resets to first-load if empty. */
    fun beginRefresh() {
        val current = feed.value.cached
        feed.value =
            if (current != null) {
                Resource.Loading(cached = current, fetchedAt = null, stale = true)
            } else {
                Resource.Loading(cached = null, fetchedAt = null, stale = false)
            }
    }
}

/**
 * Binds the surface to the shared [UptimeHeatmapStore] — the single, process-wide window store every heatmap
 * observer shares. No HTTP touches the view.
 *
 * @param store the shared window store (the web `days` prop pipeline).
 */
class StoreUptimeHeatmapSource(
    private val store: UptimeHeatmapStore,
) : UptimeHeatmapSource {
    override fun window(): Flow<Resource<UptimeWindow>> = store.window()

    override fun refresh() = store.beginRefresh()
}

/**
 * A self-contained [UptimeHeatmapSource] over a private [UptimeHeatmapStore] — the convenience seam for
 * previews and unit tests so a window can be seeded without wiring a host pipeline. Seed it via [seed] or
 * leave it loading.
 *
 * @param initial an optional window to resolve immediately; `null` leaves the feed in its loading state.
 * @param clock deterministic time source for the freshness stamp.
 */
class InMemoryUptimeHeatmapSource(
    initial: UptimeWindow? = null,
    clock: () -> Long = { System.currentTimeMillis() },
) : UptimeHeatmapSource {
    private val store = UptimeHeatmapStore(clock)

    init {
        if (initial != null) store.submit(initial)
    }

    override fun window(): Flow<Resource<UptimeWindow>> = store.window()

    override fun refresh() = store.beginRefresh()

    /** Feeds a new window into the backing store (resolves the feed to success). */
    fun seed(window: UptimeWindow) = store.submit(window)
}
