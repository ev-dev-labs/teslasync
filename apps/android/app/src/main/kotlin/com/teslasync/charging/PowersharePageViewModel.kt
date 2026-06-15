// The state holder backing the PowersharePage surface (P1/S8) — the native counterpart of the web page's five
// TanStack-Query hooks + the global vehicle scope (web/src/features/charging/pages/PowersharePage.tsx). It folds
// the five cache-then-network observation reads (`useSignalObservations`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState]. The feeds re-collect whenever the active vehicle changes
// (web `useSelectedVehicle`) or the refresh trigger bumps; with no vehicle in scope it parks on an empty success
// (the web disabled-hook case, `enabled: !!vehicleId`), which the page renders as its no-data empty state. All
// folding logic lives in the framework-free model (PowersharePageModel.kt) and the seam (PowersharePageSource.kt);
// this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.powershare

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.TelemetryRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PowersharePageViewModel(
    private val source: PowersharePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's Powershare readings as a lifecycle-aware [UiState]: loading / content / empty (no
     * status, type, stop-reason, hours, or power value) / stale / offline / error. Re-collected whenever the
     * active vehicle changes or the refresh trigger bumps. Gated on a selected vehicle (web `enabled: !!vehicleId`):
     * with no vehicle it parks on an empty success the page renders as its no-data empty state. Empty mirrors the
     * web `hasData` false branch — the friendly empty state, never a blank box.
     */
    val state: StateFlow<UiState<PowershareReadings>> =
        combine(source.selectedVehicleId(), refreshTrigger) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<PowershareReadings>>(
                        Resource.Success(PowershareReadings(), fetchedAt = 0L, stale = false),
                    )
                } else {
                    powershareReadingsResource(vehicleId, source::observation)
                }
            }
            .asUiState(isEmpty = { !it.hasData })

    /** Re-collect the five observation feeds — the web queries' `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("powershare.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the readings feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPowersharePageOpened(logger)
    }
}
