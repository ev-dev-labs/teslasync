// UI-thread-free state holder backing the MapTileLayer surface — the native port of the web
// `useQuery(['map-config'], getMapConfig)` read (web/src/components/maps/MapTileLayer.tsx selects a tile source
// from the `GET /system/map-config` document). It binds the [MapTileLayerSource] seam (P1/S8) and performs no
// HTTP itself (ADR-002): the view collects [state] and folds it through the pure [projectMapTileLayer]. The
// map-config document is the genuine cache-then-network dependency a self-contained tile-source surface
// resolves, so its lifecycle drives the surface's loading / content / error / stale / offline states.
//
// The config feed is exposed as the typed [MapConfig] (not the projection) so the chosen base-map `style` stays
// a pure render parameter — the web `style` prop, applied at the composable boundary — and switching style never
// re-fetches. The feed is never structurally empty: `/system/map-config` always resolves to a usable provider
// (the community fallback), so there is no "no data" branch in the web source to reproduce — the free-default
// case is valid content carrying its community attribution.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MapTileLayer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maptilelayer

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [MapTileLayer] surface — the Android port of the web `MapTileLayer`
 * component's `useQuery(['map-config'])` read.
 *
 * It binds the injected [MapTileLayerSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the
 * cache-then-network [MapConfig]: the composable switches surfaces — loading (first fetch ⇒ a map skeleton),
 * content (the live map + resolved tile attribution, including the community-default provider), a hard error
 * with retry, and — through the ADR-013 freshness contract — stale and offline (the cached config kept shown
 * with the staleness + error flags) — without re-deriving the contract. The view stays a thin renderer; it
 * performs no HTTP (ADR-002) and projects the config + its `style` prop through the pure [projectMapTileLayer].
 *
 * [refresh] / [retry] re-collect the feed (the web `refetch`); [onViewOpened] emits the P1/S11 `view.opened`
 * diagnostics event exactly once per surface open — slug only, never a deployment api_key or tile URL.
 *
 * @param source the map-config document seam (the real repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MapTileLayerViewModel(
    private val source: MapTileLayerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The map-config document as lifecycle-aware [UiState]. The config is never treated as structurally empty
     * (the resolver always yields a usable provider via the community fallback), so the surface shows the map
     * for every resolved value rather than a blank empty frame; loading / error / stale / offline still flow
     * from the cache-then-network envelope.
     */
    val state: StateFlow<UiState<MapConfig>> =
        refreshTrigger
            .flatMapLatest { source.mapConfig() }
            .asUiState { false }

    /** Re-fetches the map-config document after a hard error (web `refetch`); backs the retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the map-config document; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no api_key or tile URL. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMapTileLayerOpened(logger)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to MapTileLayerRegistration.SLUG)

    companion object {
        private const val EVENT_REFRESH = "mapTileLayer.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: MapTileLayerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { MapTileLayerViewModel(source, logger) }
            }
    }
}
