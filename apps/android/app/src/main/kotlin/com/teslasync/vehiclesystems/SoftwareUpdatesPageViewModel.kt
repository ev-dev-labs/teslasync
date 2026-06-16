// The state holder backing the SoftwareUpdatesPage vehicle-systems surface (P1/S8) — the native counterpart of the
// web page's React state + the inline `/software-updates` query (web/src/features/vehicle-systems/pages/
// SoftwareUpdatesPage.tsx). It projects the single cache-then-network software-update read onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], and derives the owner-name map from the
// shared vehicles feed (web `vehicleMap`). The feed re-collects whenever the effective vehicle changes (web
// `useSelectedVehicle`, which auto-selects the first vehicle when none is explicitly chosen) or the refresh trigger
// bumps. All derivation logic lives in the framework-free model (SoftwareUpdatesPageModel.kt); this holder is the
// thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.softwareupdates

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.HttpVehicleSystemsRepository] adapter
 *   + [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 *   ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftwareUpdatesPageViewModel(
    private val source: SoftwareUpdatesPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The effective active-vehicle id (web `useSelectedVehicle`): the explicit selection when present, otherwise
     * the first enrolled vehicle, otherwise `null` when the fleet is empty. Mirrors the web hook's auto-default.
     */
    private val effectiveVehicleId: StateFlow<Long?> =
        combine(source.selectedVehicleId(), source.vehicles()) { selected, vehiclesResource ->
            selected ?: vehiclesResource.cached?.firstOrNull()?.id
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /**
     * The software updates as cache-then-network UI state (web `/software-updates` query). Re-collected whenever
     * the effective vehicle or the refresh trigger changes. An empty result parks on
     * [io.teslasync.android.data.UiPhase.Empty] (the page's "No update history" surface); an absent vehicle yields
     * the same empty surface (web `enabled: vehicleId !== null`).
     */
    val updatesState: StateFlow<UiState<List<SoftwareUpdate>>> =
        combine(effectiveVehicleId, refreshTrigger) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null) {
                    flowOf(Resource.Success(emptyList<SoftwareUpdate>(), fetchedAt = 0L, stale = false))
                } else {
                    source.softwareUpdates(vehicleId.toString())
                }
            }.asUiState(isEmpty = { it.isEmpty() })

    /** The vehicle-id → display-name map the timeline resolves each row's owner against (web `vehicleMap`). */
    val vehicleNames: StateFlow<Map<Long, String>> =
        source.vehicles()
            .map { resource -> vehicleNameMap(resource.cached.orEmpty()) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyMap())

    /** Re-collect the software-update feed — the web query `refetch` / the page error-retry + pull-to-refresh. */
    fun refresh() {
        logger.info("software_updates.refresh")
        refreshTrigger.value += 1
    }

    /** Retry affordance for the feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to SoftwareUpdatesPageRegistration.SLUG))
    }
}
