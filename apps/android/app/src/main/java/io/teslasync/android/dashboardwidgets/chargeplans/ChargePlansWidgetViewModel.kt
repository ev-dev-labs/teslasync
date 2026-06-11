package io.teslasync.android.dashboardwidgets.chargeplans

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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

/**
 * State holder backing the Compose [ChargePlansWidget] — the Android port of the web
 * `ChargePlansWidget`'s hook composition (`web/src/features/dashboard/widgets/ChargePlansWidget.tsx`).
 *
 * It binds the injected [ChargePlansSource] (the P1/S8 shared-layer seam) and composes it exactly as
 * the web does: resolve the active vehicle id (`vehicleId ?? vehicles?.[0]?.id ?? 0`), keep
 * `useChargePlans` lazily gated (`enabled: id > 0`) by substituting a never-fetching empty stand-in
 * when no vehicle resolves, and fold the charge-plans + rate-plans cache-then-network resources into
 * one [UiState] of a [ChargePlansSnapshot] (web `isLoading/isFetching/isStale/isError = plansX ||
 * ratesX`). [displayPrefs] tracks the settings-derived currency/precision/locale (web
 * `useFormatting`/`useUnits`). The view stays a thin renderer; it performs no HTTP and owns no
 * business logic (ADR-002).
 *
 * [refresh]/[retry] bump a trigger that restarts a fresh upstream collection (the web `refetch()`),
 * and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared cache-then-network charging/vehicles/settings seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 * @param explicitVehicleId optional host-provided vehicle scope; when null the first enrolled wins.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargePlansWidgetViewModel(
    private val source: ChargePlansSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val explicitVehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The combined charge-plans + rate-plans snapshot as cache-then-network UI state. */
    val state: StateFlow<UiState<ChargePlansSnapshot>> =
        refreshTrigger
            .flatMapLatest { chargePlansResource() }
            .asUiState { !it.hasData }

    /** The live display preferences (currency symbol / precision / locale), re-derived as settings change. */
    val displayPrefs: StateFlow<ChargePlansPrefs> =
        refreshTrigger
            .flatMapLatest { source.settings() }
            .map { ChargePlansPrefs.from(it.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ChargePlansPrefs.DEFAULT,
            )

    /**
     * Composes the vehicles feed (for the active id) with the per-vehicle charge-plans feed and the
     * rate-plans feed into one merged resource. The vehicle resolution mirrors the web
     * `vehicleId ?? vehicles?.[0]?.id ?? 0`; when no vehicle resolves the plans feed is the
     * never-fetching [DISABLED_CHARGE_PLANS] stand-in (web `enabled: id > 0`), while rate plans —
     * which the web fetches unconditionally — still load.
     */
    private fun chargePlansResource(): Flow<Resource<ChargePlansSnapshot>> =
        source.vehicles().flatMapLatest { vehiclesRes ->
            val id = explicitVehicleId ?: firstVehicleId(vehiclesRes.cached) ?: 0L
            val plansFlow: Flow<Resource<JsonElement>> = if (id > 0L) source.chargePlans(id) else flowOf(DISABLED_CHARGE_PLANS)
            combine(plansFlow, source.ratePlans()) { plansRes, ratesRes -> mergeChargePlans(plansRes, ratesRes) }
        }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to ChargePlansRegistration.SLUG))
    }

    /** Re-fetches the plans/rates (web `handleRefresh` → `refetchPlans()` + `refetchRates()`). */
    fun refresh() {
        logger.info("chargePlans.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: ChargePlansSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChargePlansWidgetViewModel(source, logger, explicitVehicleId = vehicleId) }
            }
    }
}
