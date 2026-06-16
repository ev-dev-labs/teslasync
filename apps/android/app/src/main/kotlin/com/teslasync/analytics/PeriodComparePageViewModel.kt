// The state holder backing the PeriodComparePage analytics surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/analytics/pages/PeriodComparePage.tsx). It projects
// the shared `useVehicles` feed (the declared data source) plus the two period-stats reads onto the lifecycle-
// aware [UiState] surface and owns the page's interaction state: the active vehicle (explicit pick or the first
// enrolled vehicle, web `vehicleId || vehicles[0].id`), the two period windows, and the disambiguation-banner
// dismissal. All derivation lives in the framework-free model (PeriodComparePageModel.kt); this holder performs
// no HTTP — it drives the [PeriodCompareSource] seam and folds the two windows into one comparison.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located UI-model type.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.periodcompare

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * The immutable screen state the stateless content renders. [vehicles] drives the picker + the page-level
 * loading/empty/error for the declared `useVehicles` source; [comparison] drives the metric cards, chart, table,
 * and insights (loading / empty / error / content) for the two selected windows. [showBanner] reproduces the web
 * rule "show the fleet-comparison disambiguation banner only for multi-vehicle accounts that have not dismissed
 * it".
 */
data class PeriodCompareUiModel(
    val vehicles: UiState<List<Vehicle>>,
    val comparison: UiState<PeriodComparison>,
    val activeVehicleId: String?,
    val periodA: PeriodValue,
    val periodB: PeriodValue,
    val showBanner: Boolean,
) {
    companion object {
        val INITIAL: PeriodCompareUiModel =
            PeriodCompareUiModel(
                vehicles = UiState.loading(),
                comparison = UiState.loading(),
                activeVehicleId = null,
                periodA = PeriodValue.DEFAULT_A,
                periodB = PeriodValue.DEFAULT_B,
                showBanner = false,
            )
    }
}

/**
 * @param source the P1/S8 data seam (real Vehicles holder + resilient client ↔ test fake); the view never
 *   performs HTTP.
 * @param unitFormatter the live display-unit formatter (web `useUnits` port); a units change re-derives the
 *   comparison at the model boundary without the view knowing how the preference is stored.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PeriodComparePageViewModel(
    private val source: PeriodCompareSource,
    private val unitFormatter: StateFlow<UnitFormatter>,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val selectedVehicleId = MutableStateFlow<String?>(null)
    private val periodA = MutableStateFlow(PeriodValue.DEFAULT_A)
    private val periodB = MutableStateFlow(PeriodValue.DEFAULT_B)
    private val bannerDismissed = MutableStateFlow(false)
    private val comparisonRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The enrolled-vehicle list as cache-then-network UI state (empty fleet → empty phase). */
    private val vehicles: StateFlow<UiState<List<Vehicle>>> = source.vehicles().asUiState(isEmpty = { it.isEmpty() })

    /** The active vehicle: an explicit pick, else the first enrolled vehicle (web `vehicleId || vehicles[0].id`). */
    private val activeVehicleId: StateFlow<String?> =
        combine(selectedVehicleId, source.vehicles()) { selected, resource ->
            selected ?: resource.cached?.firstOrNull()?.id?.toString()
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /**
     * The two-window comparison as cache-then-network UI state. Re-collected whenever the active vehicle, either
     * period, the units, or the refresh trigger changes; with no active vehicle it resolves to the empty
     * comparison (web `!a || !b` empty-state). A window-read error surfaces as the hard-error phase + retry.
     */
    private val comparison: StateFlow<UiState<PeriodComparison>> =
        combine(activeVehicleId, periodA, periodB, comparisonRefresh) { id, a, b, _ -> StatsKey(id, a, b) }
            .flatMapLatest { key ->
                val id = key.vehicleId
                if (id == null) {
                    flowOf<Resource<PeriodComparison>>(
                        Resource.Success(PeriodComparison.EMPTY, fetchedAt = 0L, stale = false),
                    )
                } else {
                    combine(
                        source.periodStats(id, key.periodA.days),
                        source.periodStats(id, key.periodB.days),
                        unitFormatter,
                    ) { resA, resB, formatter -> combineStats(resA, resB, formatter.prefs) }
                }
            }.asUiState(isEmpty = { it.metrics.isEmpty() })

    /** The single screen state the stateless content collects. */
    val state: StateFlow<PeriodCompareUiModel> =
        combine(vehicles, comparison, activeVehicleId, selectionState()) { vehiclesState, comparisonState, activeId, selection ->
            PeriodCompareUiModel(
                vehicles = vehiclesState,
                comparison = comparisonState,
                activeVehicleId = activeId,
                periodA = selection.periodA,
                periodB = selection.periodB,
                showBanner = !selection.bannerDismissed && (vehiclesState.data?.size ?: 0) >= MIN_VEHICLES_FOR_BANNER,
            )
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), PeriodCompareUiModel.INITIAL)

    /** Selects the comparison vehicle (web `setVehicleId`). */
    fun selectVehicle(vehicleId: String) {
        selectedVehicleId.value = vehicleId
    }

    /** Sets Period A's trailing window (web `setPeriodA`). */
    fun setPeriodA(value: PeriodValue) {
        periodA.value = value
    }

    /** Sets Period B's trailing window (web `setPeriodB`). */
    fun setPeriodB(value: PeriodValue) {
        periodB.value = value
    }

    /** Dismisses the fleet-comparison disambiguation banner for this session (web `dismissBanner`). */
    fun dismissBanner() {
        bannerDismissed.value = true
    }

    /** Re-fetches both period windows (the web error-state retry / query refetch). */
    fun retry() {
        logger.info("periodCompare.refresh")
        comparisonRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPeriodComparePageOpened(logger)
    }

    private fun selectionState() =
        combine(periodA, periodB, bannerDismissed) { a, b, dismissed -> Selection(a, b, dismissed) }

    private fun combineStats(
        a: Resource<PeriodStats>,
        b: Resource<PeriodStats>,
        prefs: UnitPref,
    ): Resource<PeriodComparison> =
        when {
            a is Resource.Success && b is Resource.Success ->
                Resource.Success(
                    buildComparison(a.data, b.data, prefs),
                    fetchedAt = maxOf(a.fetchedAt, b.fetchedAt),
                    stale = false,
                )

            a is Resource.Error -> Resource.Error(cached = null, fetchedAt = null, stale = false, error = a.error)
            b is Resource.Error -> Resource.Error(cached = null, fetchedAt = null, stale = false, error = b.error)
            else -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
        }

    private data class StatsKey(
        val vehicleId: String?,
        val periodA: PeriodValue,
        val periodB: PeriodValue,
    )

    private data class Selection(
        val periodA: PeriodValue,
        val periodB: PeriodValue,
        val bannerDismissed: Boolean,
    )

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L

        /** The web hides the banner for single-vehicle accounts (they cannot usefully cross-navigate to fleet). */
        const val MIN_VEHICLES_FOR_BANNER = 2
    }
}
