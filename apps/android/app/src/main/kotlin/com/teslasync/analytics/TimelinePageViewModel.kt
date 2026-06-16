// The state holder backing the TimelinePage analytics surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/analytics/pages/TimelinePage.tsx). It projects the
// `useVehicles` fleet feed (for the vehicle-scope picker + the `useSelectedVehicle` default-to-first reconcile) and
// the `useTimeline` transitions feed (scoped to the global active vehicle) onto the shared lifecycle-aware [UiState]
// surface. All decode/derivation logic lives in the framework-free model (TimelinePageModel.kt); this holder is the
// thin orchestration layer and performs no HTTP.
//
// The timeline feed re-collects whenever the selected vehicle changes (a new
// `/vehicle-states/timeline?vehicle_id={id}` read) or the refresh trigger bumps; with no selection it short-circuits
// to an empty payload (web `enabled: activeId !== ''`) so the surface still renders while the selection reconciles.
// An empty transitions payload resolves to UiPhase.Empty via [TimelineData.isEmpty] so every section shows its
// empty-state. Both FSM endpoints are @deprecated/404 post Phase-42, so the first load hard-errors with no cache and
// the page shows its error surface + retry (see TimelinePageModel for the full divergence note).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.timeline

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** One selectable vehicle for the scope picker (web `{ value: String(id), label: display_name || vin }`). */
data class TimelineVehicleOption(
    val id: Long,
    val label: String,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] +
 *   [io.teslasync.shared.core.presentation.analytics.AnalyticsStore] + [io.teslasync.android.data.SelectedVehicleStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `select` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock the wall-clock seam used to measure the newest transition's open dwell interval (web `Date.now()`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TimelinePageViewModel(
    private val source: TimelinePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The enrolled-vehicle options as cache-then-network UI state (web `useVehicles`). Backs the vehicle-scope
     * picker; an empty fleet resolves to UiPhase.Empty so the picker is simply omitted (web `vehicles.length > 0`).
     */
    val vehicles: StateFlow<UiState<List<TimelineVehicleOption>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .map { resource -> resource.mapData { list -> list.map(::toOption) } }
            .asUiState { it.isEmpty() }

    /** The global active-vehicle selection (web `useSelectedVehicle().vehicleId`), seeds the picker's current value. */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /**
     * The decoded timeline payload as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind. Re-collected whenever the active vehicle changes or the
     * refresh trigger bumps. Empty mirrors the [TimelineData.isEmpty] gate (no transitions in the window).
     */
    val state: StateFlow<UiState<TimelineData>> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null || id <= 0L) flowOf(emptyTimelineResource()) else source.timeline(id.toString())
            }
            .map { resource -> resource.mapData { json -> buildTimelineData(json, clock()) } }
            .asUiState { it.isEmpty }

    init {
        // Self-heal the app-wide selection from the live list: keep a valid choice, else auto-pick the first vehicle,
        // else clear when the fleet is empty — the web `useSelectedVehicle` "default to first" effect.
        launch {
            source.vehicles().collect { resource ->
                resource.cached?.let { list -> source.reconcile(list.map(Vehicle::id)) }
            }
        }
    }

    /** Selects [id] as the active vehicle for every vehicle-scoped screen (web `setVehicleId`). */
    fun select(id: Long) {
        source.select(id)
        logger.info("timeline.select", mapOf(SURFACE_KEY to TimelinePageRegistration.SLUG))
    }

    /** Re-runs the cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("timeline.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface — identical to [refresh]. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / transition payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTimelineOpened(logger)
    }

    private fun toOption(vehicle: Vehicle): TimelineVehicleOption =
        TimelineVehicleOption(id = vehicle.id, label = vehicle.displayName.ifBlank { vehicle.vin })

    private companion object {
        const val SURFACE_KEY = "surface"
    }
}
