// The state holder backing the MediaPlayerPage vehicle-systems surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx). It projects
// the backend `GET /media/latest` (now-playing) and `GET /media` (listening history) reads onto the shared
// lifecycle-aware [UiState] surface, scoped to the global active vehicle (web `useSelectedVehicle`), and derives the
// live display locale from the `/settings` document (web `useFormatting`). All decode/derivation logic lives in the
// framework-free model (MediaPlayerPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The latest feed re-collects whenever the active vehicle changes or the refresh trigger bumps; a null decode (web
// `latest?`) resolves to UiPhase.Empty so the now-playing card shows its "No track" fallback, and a hard transport
// failure (with no cache) resolves to UiPhase.Error (the page's retry surface). The history feed re-collects on the
// same triggers and is folded by the framework-free model (mediaStats / volumePoints / sourceSlices) into the metric
// cards, the volume + source charts, and the playback-history table; it never gates the page, so each of those
// sections renders its own empty surface (web `volumeChartData.length > 0 ? … : <EmptyState />`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.mediaplayer

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * @param source the P1/S8 data seam (the shared resilient client + the app-scoped active-vehicle selection + the
 *   shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MediaPlayerPageViewModel(
    private val source: MediaPlayerPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle media reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `GET /media/latest` now-playing snapshot as cache-then-network UI state (web `useQuery(['media','latest'])`).
     * Re-collected on vehicle change / refresh; a null decode or no selected vehicle (web `enabled: !!activeId`)
     * resolves to the empty surface so the now-playing card shows its fallback, and a hard failure to the error surface.
     */
    val latestState: StateFlow<UiState<MediaSnapshot?>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) noVehicleFeed else source.latestMedia(vehicleId)
            }
            .map { it.mapData(::parseLatestMedia) }
            .asUiState(isEmpty = { it == null })

    /**
     * The `GET /media` listening-history feed as cache-then-network UI state (web `useQuery(['media','history'])`).
     * Re-collected on vehicle change / refresh; gated on a selected vehicle (web `enabled: !!activeId`). Feeds the
     * metric cards + the volume/source charts + the playback-history table — it never gates the page, so those sections
     * render their own empty surfaces.
     */
    val historyState: StateFlow<UiState<List<MediaSnapshot>>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) noVehicleFeed else source.mediaHistory(vehicleId)
            }
            .map { it.mapData(::parseMediaHistory) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The live display preferences derived from the settings document (web `useFormatting`). Falls back to en-US. */
    val displayPrefs: StateFlow<MediaPlayerDisplayPrefs> =
        source
            .settings()
            .map { resource -> MediaPlayerDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = MediaPlayerDisplayPrefs.DEFAULT,
            )

    /** Re-runs both cache-then-network reads (the web `refetchInterval` analogue + the error-surface retry). */
    fun refresh() {
        logger.info("media.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no track / artist / vehicle payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMediaPlayerPageOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val noVehicleFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonNull, 0L, false))
    }
}
