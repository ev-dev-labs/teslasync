// The state holder backing the VehicleCostPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/admin/pages/VehicleCostPage.tsx). It owns the page's local
// interaction state (the selected observation window and the `since` lower bound derived from it) as a single
// immutable [VehicleCostInteraction] snapshot and projects the single cache-then-network read
// (`GET /admin/observability/vehicle-cost`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState]. The feed re-collects whenever the window changes (a new `since` lower bound,
// web `useVehicleCost(since, 100)`) or the refresh trigger bumps. The HTTP 503 / subsystem-not-configured branch
// (web `error.status === 503`) is preserved through [UiState.httpStatus] for the render layer to surface the
// "subsystem unavailable" banner. All derivation logic lives in the framework-free model
// (VehicleCostPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.vehiclecost

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real
 *   [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] adapter ↔ test fake);
 *   the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock the wall-clock source for the `since` lower bound (web `Date.now()`); a test seam so the derived
 *   `since` ISO is deterministic off-device.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleCostPageViewModel(
    private val source: VehicleCostSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction =
        MutableStateFlow(
            VehicleCostInteraction(
                window = DEFAULT_VEHICLE_COST_WINDOW,
                sinceIso = vehicleCostSinceIso(clock(), DEFAULT_VEHICLE_COST_WINDOW.days),
            ),
        )
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `windowDays` `useState` + the `since` `useMemo`). */
    val interaction: StateFlow<VehicleCostInteraction> = mutableInteraction.asStateFlow()

    /**
     * The vehicle-cost report as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the window changes (a new `since` feed key, web `useVehicleCost(since, 100)`)
     * or the refresh trigger bumps. The empty predicate is the model's "no vehicle rows" guard (web
     * `vehicles.length === 0`), so a report with at least one vehicle resolves to content (the table) rather than
     * the empty panel.
     */
    val state: StateFlow<UiState<VehicleCostResponse>> =
        combine(mutableInteraction, refreshTrigger) { interaction, _ -> interaction }
            .flatMapLatest { interaction -> source.vehicleCost(interaction.sinceIso, VEHICLE_COST_LIMIT) }
            .asUiState(isEmpty = { it.isEmptyVehicles })

    // ── Interaction setters (web `setWindowDays`) ────────────────────────────────────────────────────────────────

    /**
     * Choose the observation window (web `setWindowDays`). Recomputes the `since` lower bound from the current
     * wall clock (web `useMemo([windowDays])`), so a window change is a new feed key while an ordinary refresh
     * keeps the same `since`.
     */
    fun setWindow(window: VehicleCostWindow): Unit =
        mutableInteraction.update {
            it.copy(window = window, sinceIso = vehicleCostSinceIso(clock(), window.days))
        }

    // ── Refresh / retry (web query `refetch` + the error-state retry) ────────────────────────────────────────────

    /** Re-fetch the active vehicle-cost feed (the web `refetchInterval` / error-retry affordance). */
    fun refresh() {
        logger.info("vehicleCost.refresh")
        source.refresh(mutableInteraction.value.sinceIso, VEHICLE_COST_LIMIT)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehicleCostPageOpened(logger)
    }
}
