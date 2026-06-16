// The state holder backing the SmartChargePage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/charging/pages/SmartChargePage.tsx). It owns the page's local
// form + result interaction state (the `targetSoc`/`departBy`/`ratePlanId`/`maxAmps`/`batteryCapacity` group, the
// optimize `result`, and the `applied` flag) as a single immutable [SmartChargeInteractionState] snapshot, projects
// the two cache-then-network raw-JSON reads (`useRatePlans`, `useChargePlans`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState], and orchestrates the two mutations (`useOptimizeCharge`,
// `useApplySchedule`) off the UI thread, surfacing their in-flight / success / error states. All derivation +
// decoding lives in the framework-free model (SmartChargePageModel.kt); this holder is the thin orchestration layer
// and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.smartcharge

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import java.time.Clock

/**
 * @param source the P1/S8 data seam (real [SmartChargePageSource] over the shared
 *   [io.teslasync.shared.core.data.repo.ChargingRepository] adapter + [io.teslasync.android.data.SelectedVehicleStore]
 *   ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh + mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock the depart-by-normalization + default-departure seam (web `new Date()`); injected as a fixed clock
 *   off-device.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SmartChargePageViewModel(
    private val source: SmartChargePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: Clock = Clock.systemDefaultZone(),
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction =
        MutableStateFlow(SmartChargeInteractionState(departBy = defaultDepartBy(clock.instant(), clock.zone)))
    private val plansRefresh = MutableStateFlow(0)
    private val optimizingState = MutableStateFlow(false)
    private val optimizeErrorState = MutableStateFlow<String?>(null)
    private val applyingState = MutableStateFlow(false)
    private val applyErrorState = MutableStateFlow<String?>(null)
    private var viewOpenedRecorded = false

    /** The page's local form + result snapshot (web `useState` group). */
    val interaction: StateFlow<SmartChargeInteractionState> = mutableInteraction.asStateFlow()

    /** Whether an optimization is in flight — disables the optimize button (web `optimizeMutation.isPending`). */
    val optimizing: StateFlow<Boolean> = optimizingState.asStateFlow()

    /** The last optimization error message, or `null` when none (web `optimizeMutation.error?.message`). */
    val optimizeError: StateFlow<String?> = optimizeErrorState.asStateFlow()

    /** Whether an apply is in flight — disables the apply button (web `applyMutation.isPending`). */
    val applying: StateFlow<Boolean> = applyingState.asStateFlow()

    /** The last apply error message, or `null` when none (web `applyMutation.error?.message`). */
    val applyError: StateFlow<String?> = applyErrorState.asStateFlow()

    /** The active vehicle id (web `useSelectedVehicle().vehicleId`); drives the optimize button's disabled state. */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /**
     * The available TOU rate plans as cache-then-network UI state (web `useRatePlans`). The page decodes the raw
     * JSON into the rate-plan dropdown options at the display boundary.
     */
    val ratePlansState: StateFlow<UiState<JsonElement>> = source.ratePlans().asUiState(isEmpty = ::jsonArrayEmpty)

    /**
     * The charge-plan history as cache-then-network UI state (web `useChargePlans`). Re-collected whenever the
     * active vehicle changes or the refresh trigger bumps. Gated on a selected vehicle (web `enabled: !!vehicleId`):
     * with no vehicle it parks on an empty success the page renders as the no-history empty state.
     */
    val plansState: StateFlow<UiState<JsonElement>> =
        combine(source.selectedVehicleId(), plansRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) flowOf(DISABLED_PLANS) else source.chargePlans(vehicleId)
            }
            .asUiState(isEmpty = ::jsonArrayEmpty)

    // ── Form setters (web `setTargetSoc` / `setDepartBy` / `setRatePlanId` / `setMaxAmps` / `setBatteryCapacity`) ──

    /** Set the target state-of-charge (web `setTargetSoc`). */
    fun setTargetSoc(value: Int) {
        mutableInteraction.update { it.copy(targetSoc = value) }
    }

    /** Set the local datetime-local departure string (web `setDepartBy`). */
    fun setDepartBy(value: String) {
        mutableInteraction.update { it.copy(departBy = value) }
    }

    /** Select a TOU rate plan (web `setRatePlanId`). */
    fun setRatePlan(id: String) {
        mutableInteraction.update { it.copy(ratePlanId = id) }
    }

    /** Set the charge amperage cap (web `setMaxAmps`). */
    fun setMaxAmps(value: Int) {
        mutableInteraction.update { it.copy(maxAmps = value) }
    }

    /** Set the battery capacity in kWh (web `setBatteryCapacity`). */
    fun setBatteryCapacity(value: Double) {
        mutableInteraction.update { it.copy(batteryCapacity = value) }
    }

    // ── Mutations (web `useOptimizeCharge` / `useApplySchedule`) ──────────────────────────────────────────────────

    /**
     * Optimizes the charge schedule (web `handleOptimize`). A no-op with no active vehicle (web `if (!vehicleIdNum)
     * return`) or while one is already in flight. Resets the previous result + applied flag (web `setApplied(false);
     * setResult(null)`), then runs the mutation off the UI thread and stores the decoded result on success or the
     * error message on failure.
     */
    fun optimize() {
        val vehicleId = source.selectedVehicleId().value ?: return
        if (optimizingState.value) return
        val snapshot = mutableInteraction.value
        mutableInteraction.update { it.copy(result = null, applied = false) }
        optimizeErrorState.value = null
        optimizingState.value = true
        logger.info("smartCharge.optimize.start")
        launch {
            val input =
                OptimizeChargeInput(
                    vehicleId = vehicleId,
                    targetSoc = snapshot.targetSoc,
                    departBy = departByToIso(snapshot.departBy, clock.zone, clock.instant()),
                    ratePlanId = snapshot.ratePlanId,
                    maxAmps = snapshot.maxAmps,
                    batteryCapacityKwh = snapshot.batteryCapacity,
                )
            source
                .optimize(input)
                .onSuccess { element ->
                    logger.info("smartCharge.optimize.ok")
                    mutableInteraction.update { it.copy(result = decodeOptimizeResult(element)) }
                }
                .onFailure { error ->
                    logger.warn("smartCharge.optimize.fail")
                    optimizeErrorState.value = error.message ?: ""
                }
            optimizingState.value = false
        }
    }

    /**
     * Applies the last optimized plan to the vehicle (web `handleApply`). A no-op with no result (web `if (!result)
     * return`) or while one is already in flight. On success sets the applied flag (web `setApplied(true)`) and
     * re-fetches the history feed (web `invalidateAndBroadcast(chargePlannerKeys.all)`).
     */
    fun apply() {
        val plan = mutableInteraction.value.result ?: return
        if (applyingState.value) return
        applyErrorState.value = null
        applyingState.value = true
        logger.info("smartCharge.apply.start")
        launch {
            source
                .apply(ApplyScheduleInput(plan.planId))
                .onSuccess {
                    logger.info("smartCharge.apply.ok")
                    mutableInteraction.update { it.copy(applied = true) }
                    plansRefresh.update { it + 1 }
                }
                .onFailure { error ->
                    logger.warn("smartCharge.apply.fail")
                    applyErrorState.value = error.message ?: ""
                }
            applyingState.value = false
        }
    }

    // ── Refresh / retry (the history feed's refetch + the error-state retry) ──────────────────────────────────────

    /** Re-fetch the history feed — the web query `refetch` / the error-retry affordance. */
    fun refresh() {
        logger.info("smartCharge.refresh")
        plansRefresh.update { it + 1 }
    }

    /** Retry affordance for the history feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSmartChargePageOpened(logger)
    }

    private companion object {
        /**
         * A `GET /charge-planner/history` "disabled" stand-in — the native analogue of the web `useChargePlans(undefined)`
         * lazy gate (`enabled: !!vehicleId`): an already-resolved empty array that is never loading, never errored.
         */
        val DISABLED_PLANS: Resource<JsonElement> = Resource.Success(JsonArray(emptyList()), fetchedAt = 0L, stale = false)

        /** Treats a non-array or empty-array JSON payload as the page's empty state (web `safeArray` + `length === 0`). */
        fun jsonArrayEmpty(element: JsonElement): Boolean = (element as? JsonArray)?.isEmpty() ?: true
    }
}
