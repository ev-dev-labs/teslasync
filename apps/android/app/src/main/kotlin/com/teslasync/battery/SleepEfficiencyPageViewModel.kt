// The state holder backing the SleepEfficiencyPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hook (web/src/features/battery/pages/SleepEfficiencyPage.tsx). It projects the single
// cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display preferences (temperature unit + currency + precision + locale) from
// the live `/settings` document (web `useUnits`/`useFormatting`). All decode/derivation logic lives in the
// framework-free model (SleepEfficiencyPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed is the sleep-efficiency read (web `useSleepEfficiency`): it re-collects whenever the selected vehicle
// changes (a new `/analytics/sleep?vehicle_id={id}` read) or the refresh trigger bumps, and a no-object / no-vehicle
// payload resolves to UiPhase.Empty via [SleepEfficiency.hasData] so the page shows its `noData` state (the web
// `sleep ? … : <noData>` guard).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.sleepefficiency

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
 * @param source the P1/S8 data seam (the page-local sleep repository + the shared Settings holder + the app-scoped
 *   active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SleepEfficiencyPageViewModel(
    private val source: SleepEfficiencyPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `/analytics/sleep` feed as cache-then-network UI state (web `sleep`). Re-collected when the active vehicle
     * changes or refresh bumps; a no-object payload (or no selection — web `enabled: vehicleId !== null`) resolves to
     * the empty surface (web `<noData>`).
     */
    val sleep: StateFlow<UiState<SleepEfficiency>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::sleepEfficiency) ?: emptyObjectFeed }
            .map { it.mapData(::parseSleepEfficiency) }
            .asUiState(isEmpty = { !it.hasData })

    /** The live display preferences (temperature unit + currency symbol + precision + locale), re-derived on change. */
    val displayPrefs: StateFlow<SleepDisplayPrefs> =
        source
            .settings()
            .map { resource -> SleepDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = SleepDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("sleep.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / drain / cost / temperature payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSleepEfficiencyOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : ''`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
