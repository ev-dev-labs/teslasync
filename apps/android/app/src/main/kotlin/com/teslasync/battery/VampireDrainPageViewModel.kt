// The state holder backing the VampireDrainPage surface (P1/S8) — the native counterpart of the web page's React state +
// TanStack-Query hook (web/src/features/battery/pages/VampireDrainPage.tsx). It projects the single cache-then-network
// `/vampire-drain/stats` read onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle
// (web `useSelectedVehicle`), and derives the display preferences (the locale used for grouped-number + date formatting)
// from the live `/settings` document (web `useFormatting`). All decode/derivation logic lives in the framework-free
// model (VampireDrainPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed re-collects whenever the selected vehicle changes or the refresh trigger bumps. A no-selection scope resolves
// to the synthetic empty-object feed (web `enabled: activeId !== ''`), and the stats are kept as content even when every
// figure is zero so the page always renders its panels with internal empty / skeleton fallbacks rather than a blank page
// — exactly like the web, which never replaces the deterministic panels with a page-level empty state (the
// gauge/charts/table each show their own skeleton / empty surface).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.vampiredrain

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
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the shared Energy + Settings holders + the app-scoped active-vehicle selection in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VampireDrainPageViewModel(
    private val source: VampireDrainPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary `/vampire-drain/stats` feed as cache-then-network UI state (web `useVampireDrainStats`). Re-collected
     * when the active vehicle changes or refresh bumps; a no-selection scope (web `activeId === ''`) resolves to the
     * synthetic empty payload. Zero/empty stats stay content so the panels always render (`isEmpty = { false }`).
     */
    val stats: StateFlow<UiState<VampireDrainStats>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::vampireDrainStats) ?: emptyObjectFeed }
            .map { it.mapData(::parseVampireStats) }
            .asUiState(isEmpty = { false })

    /** The live display preferences (the locale used for grouped-number + date formatting), re-derived as settings change. */
    val displayPrefs: StateFlow<VampireDisplayPrefs> =
        source
            .settings()
            .map { resource -> VampireDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = VampireDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("vampireDrain.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / drain figure payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVampireDrainOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to all-zero stats rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
