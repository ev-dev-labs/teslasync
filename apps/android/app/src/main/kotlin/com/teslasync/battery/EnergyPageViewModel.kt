// The state holder backing the EnergyPage battery surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/battery/pages/EnergyPage.tsx). It projects the three cache-then-network
// reads onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web
// `useSelectedVehicle`), and derives the display preferences (distance/energy/power unit + currency + locale +
// precision) from the live `/settings` document (web `useUnits`/`useFormatting`). All decode/derivation logic lives in
// the framework-free model (EnergyPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The primary feed is the energy-stats read: it re-collects whenever the selected vehicle changes (a new
// `/vehicles/{id}/energy` read) or the refresh trigger bumps, and an absent / all-zero payload resolves to
// UiPhase.Empty via [EnergyStats.hasData]. The page renders its body on every non-loading, non-error state, so an empty
// payload still shows the full panel set with an honest empty hero (the web `hasNoEnergyData` behaviour) rather than a
// page-level blank — exactly mirroring the web. The two secondary feeds (paginated sessions, the live charging-
// telemetry snapshot) are each their own lifecycle-aware [UiState] so every panel renders its own loading / content /
// empty surface without ever hiding a section.
//
// The trailing window is the page's fixed 30-day default (web `defaultStartDate = today - 30` .. `today`): the
// energy-stats read uses `days=30` and the sessions read is filtered to the same [windowStart]..[windowEnd].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.energy

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
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
import java.time.LocalDate

/**
 * @param source the P1/S8 data seam (the page-local charging repository + the real Energy/Vehicles/Settings holders +
 *   the app-scoped active-vehicle selection in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyPageViewModel(
    private val source: EnergyPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** End of the trailing window (today), ISO date — web `defaultEndDate`. */
    private val windowEnd: String = LocalDate.now().toString()

    /** Start of the trailing window (today − 30d), ISO date — web `defaultStartDate`. */
    private val windowStart: String = LocalDate.now().minusDays(ENERGY_WINDOW_DAYS.toLong()).toString()

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The primary `/vehicles/{id}/energy` feed as cache-then-network UI state. Re-collected when the active vehicle
     * changes or refresh bumps; an absent payload (or no selection — web `enabled: vehicleId !== null`) resolves to the
     * empty phase, though the page still renders the body with an honest empty hero (web `hasNoEnergyData`).
     */
    val state: StateFlow<UiState<EnergyStats>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::energyStats) ?: emptyObjectFeed }
            .map { it.mapData(::parseEnergyStats) }
            .asUiState(isEmpty = { !it.hasData })

    /** The paginated `/charging` feed (web `useChargingSessionsPaginated`) — the typed SI sessions the body aggregates. */
    val sessions: StateFlow<UiState<List<ChargingSession>>> =
        scopedVehicleId
            .flatMapLatest { id ->
                id.positiveId()?.let { vid -> source.chargingSessions(vid, windowStart, windowEnd) } ?: emptyListFeed
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The live `/charging-telemetry/latest` feed (web `useChargingTelemetryLatest`) — backs the lifetime panel. */
    val live: StateFlow<UiState<EnergyLive>> =
        scopedVehicleId
            .flatMapLatest { id -> id.positiveId()?.let(source::chargingTelemetryLatest) ?: emptyObjectFeed }
            .map { it.mapData(::parseEnergyLive) }
            .asUiState(isEmpty = { it.lifetimeEnergyUsedKwh == null })

    /** The live display preferences (units + currency symbol + precision + locale), re-derived as settings change. */
    val displayPrefs: StateFlow<EnergyDisplayPrefs> =
        source
            .settings()
            .map { resource -> EnergyDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = EnergyDisplayPrefs.DEFAULT,
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("energy.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / distance / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordEnergyOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : null`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    /** A positive selection as a numeric id, or null when nothing is selected (web `vehicleId ?? 0` enabled gate). */
    private fun Long?.positiveId(): Long? = this?.takeIf { it > 0L }

    private companion object {
        /** The synthetic "no selection" payloads so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
        private val emptyListFeed: Flow<Resource<List<ChargingSession>>> =
            flowOf(Resource.Success(emptyList(), 0L, false))
    }
}
