// The state holder backing the TripPlannerPage driving surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/driving/pages/TripPlannerPage.tsx). It owns the page's
// local form (origin/destination text + resolved pins, the two SOC sliders, the driving-speed multiplier) and the
// one mutation the page drives (`usePlanTrip` ▸ `POST /trip-planner/plan`), projects the plan onto the shared
// lifecycle-aware [UiState] surface, and derives the live display preferences from the `/settings` document (web
// `useUnits` / `useFormatting`), the fleet picker options (web `useVehicles`), and the active vehicle's battery
// level (web `useVehicleState`). All decode/derivation logic lives in the framework-free model
// (TripPlannerPageModel.kt); this holder is the thin orchestration layer and performs no HTTP itself.
//
// The plan is mutation-driven, not a standing feed: it rests at [UiPhase.Empty] (no plan yet — the page shows just
// its form, mirroring the web `{route && …}` guards) until [planTrip] runs, then transitions Loading → Content on
// success or Loading → Error on failure. A prior plan stays visible across a re-plan and across a failure, exactly
// as the web mutation keeps the last `plan` state (which is only replaced `onSuccess`) and renders the error
// banner alongside it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.tripplanner

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

/** One fleet vehicle as a picker option (web `VehicleSelect` option) — the id + its display name. */
data class TripVehicleOption(
    val id: Long,
    val label: String,
)

/**
 * @param source the P1/S8 data seam (the real shared driving repository + the shared vehicles/settings holders +
 *   the app-scoped active-vehicle selection + the resilient client in production ↔ a test fake); the view never
 *   performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the plan outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripPlannerPageViewModel(
    private val source: TripPlannerPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableForm = MutableStateFlow(TripPlannerFormState())
    private val mutablePlan = MutableStateFlow(IDLE_PLAN)
    private var viewOpenedRecorded = false
    private var planJob: Job? = null

    /** The local form state (web `useState` block) the composable binds the inputs to. */
    val form: StateFlow<TripPlannerFormState> = mutableForm.asStateFlow()

    /**
     * The trip-plan mutation surface (web `usePlanTrip`). Rests at [UiPhase.Empty] until [planTrip] runs, then
     * Loading → Content (success) or Loading → Error (failure); the previous plan stays in [UiState.data] across a
     * re-plan and a failure (web keeps `plan` set after a failed mutation).
     */
    val planState: StateFlow<UiState<TripPlanResult>> = mutablePlan.asStateFlow()

    /** The active vehicle id (web `useSelectedVehicle`), scoping the plan request + the battery chip. */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /** The fleet picker options (web `useVehicles` → `VehicleSelect`), derived from the cache-then-network feed. */
    val vehicleOptions: StateFlow<List<TripVehicleOption>> =
        source
            .vehicles()
            .map { resource -> resource.cached?.map { TripVehicleOption(it.id, it.displayName) } ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /** The live display preferences derived from the settings document (web `useUnits` / `useFormatting`). */
    val displayPrefs: StateFlow<TripPlannerDisplayPrefs> =
        source
            .settings()
            .map { TripPlannerDisplayPrefs.from(it.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), TripPlannerDisplayPrefs.default())

    /** The active vehicle's battery percent (web `currentVehicle.battery_level`), or null when unavailable. */
    val vehicleBattery: StateFlow<Int?> =
        selectedVehicleId
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf(null)
                } else {
                    source.vehicleState(id).map { it.cached?.state?.batteryLevel?.toInt() }
                }
            }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /** Whether the "Plan Trip" action is enabled (web `origin && destination && activeVehicle !== ''`). */
    val canPlan: StateFlow<Boolean> =
        combine(mutableForm, selectedVehicleId) { form, vehicleId -> form.hasEndpoints && (vehicleId ?: 0L) > 0L }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), false)

    /** The geocode seam the AddressInput children bind to (web `useGeocodeSearch`). */
    fun geocode(query: String): Flow<Resource<JsonElement>> = source.geocode(query)

    /** Raises typed origin text (web `setOriginText` / `AddressInput onChange`). */
    fun setOriginText(text: String): Unit = mutableForm.update { it.copy(originText = text) }

    /** Raises typed destination text (web `setDestText`). */
    fun setDestText(text: String): Unit = mutableForm.update { it.copy(destText = text) }

    /** Resolves the picked origin pin (web `setOrigin` on `AddressInput onSelect`). */
    fun selectOrigin(location: TripLocationInput): Unit = mutableForm.update { it.copy(origin = location) }

    /** Resolves the picked destination pin (web `setDestination`). */
    fun selectDestination(location: TripLocationInput): Unit = mutableForm.update { it.copy(destination = location) }

    /** Updates the current-SOC slider (web `setCurrentSOC`). */
    fun setCurrentSoc(value: Int): Unit = mutableForm.update { it.copy(currentSoc = value) }

    /** Updates the min-arrival-SOC slider (web `setMinArrivalSOC`). */
    fun setMinArrivalSoc(value: Int): Unit = mutableForm.update { it.copy(minArrivalSoc = value) }

    /** Updates the driving-speed multiplier (web `setSpeedFactor`). */
    fun setSpeedFactor(value: Double): Unit = mutableForm.update { it.copy(speedFactor = value) }

    /** Persists a new active-vehicle selection (web `VehicleSelect` `onChange` → `setVehicleId`). */
    fun selectVehicle(id: Long): Unit = source.selectVehicle(id)

    /**
     * Runs the plan mutation (web `handlePlan`). A no-op unless both endpoints are picked and a vehicle is active
     * (web early `return`). Moves the surface to Loading (keeping any prior plan visible), then to Content on
     * success or Error on failure; the previous plan survives a failure, matching the web mutation.
     */
    fun planTrip() {
        val vehicleId = selectedVehicleId.value?.takeIf { it > 0L } ?: return
        val request = buildPlanRequest(mutableForm.value, vehicleId) ?: return
        planJob?.cancel()
        mutablePlan.update { current -> current.copy(phase = UiPhase.Loading, errorKind = null, httpStatus = null) }
        planJob =
            stateScope.launch {
                source
                    .planTrip(request)
                    .onSuccess { json ->
                        mutablePlan.value =
                            UiState(UiPhase.Content, data = parseTripPlan(json), fetchedAt = System.currentTimeMillis())
                        logger.info("tripPlanner.plan.success")
                    }.onFailure { error ->
                        mutablePlan.update { current ->
                            current.copy(
                                phase = UiPhase.Error,
                                errorKind = errorKindOf(error),
                                httpStatus = httpStatusOf(error),
                            )
                        }
                        logger.warn("tripPlanner.plan.fail", mapOf("kind" to errorKindOf(error).name))
                    }
            }
    }

    /** Retry affordance for the plan error surface — re-runs the last-configured plan. */
    fun retry(): Unit = planTrip()

    /**
     * Sends the planned destination to the car as a navigation request (web `handleSendToCar`). Best-effort: the
     * web page swallows failures, so a failed [TripPlannerPageSource.sendNavigation] only logs.
     */
    fun sendToCar() {
        val vehicleId = selectedVehicleId.value?.takeIf { it > 0L } ?: return
        val destination = mutableForm.value.destination ?: return
        launch {
            source
                .sendNavigation(vehicleId, destination.lat, destination.lng)
                .onFailure { error -> logger.warn("tripPlanner.sendToCar.fail", mapOf("kind" to errorKindOf(error).name)) }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / coordinate / cost payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTripPlannerPageOpened(logger)
    }

    private companion object {
        /** The resting "no plan yet" surface: empty with the absent plan so only the form renders. */
        private val IDLE_PLAN: UiState<TripPlanResult> = UiState(UiPhase.Empty, data = TripPlanResult.EMPTY)
    }
}
