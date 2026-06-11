// The data port the FSM State Distribution widget binds to — the native analogue of the four web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`),
// `useFSMStats` (the `/fsm/stats` state→ms envelope), and `useFSMTransitions` (the `/fsm/transitions`
// paged log, called with the fixed `('vehicle', 24, 1, 5)` arguments the web source passes). See
// web/src/features/dashboard/widgets/FSMDistributionWidget.tsx + web/src/api/hooks/useFSM.ts +
// web/src/api/hooks/useVehicles.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model folds each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FSMDistributionWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fsmdistribution

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.FsmRepository
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.fsm.FsmStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

// The fixed transition-query arguments the web source passes: `useFSMTransitions(id, 'vehicle', 24, 1, 5)`.
// The widget only ever reads the vehicle FSM over the last 24h, first page, five rows — so the seam hides
// these (a host never reconfigures them), exactly as the web call site bakes them in.
private val TRANSITIONS_FSM_TYPE = FsmType.VEHICLE
private const val TRANSITIONS_HOURS = 24
private const val TRANSITIONS_PAGE = 1
private const val TRANSITIONS_PER_PAGE = 5

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * per-vehicle [stats] envelope (the rendered `GET /fsm/stats?vehicle_id=` state→ms feed), and the
 * per-vehicle [transitions] log (the `GET /fsm/transitions?vehicle_id=…&fsm_name=vehicle&hours=24&page=1&
 * per_page=5` feed). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network.
 */
interface FSMDistributionSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /fsm/stats?vehicle_id={id}` state→ms feed (web `useFSMStats`). */
    fun stats(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The cache-then-network `GET /fsm/transitions?vehicle_id={id}&fsm_name=vehicle&hours=24&page=1&per_page=5`
     * feed (web `useFSMTransitions`).
     */
    fun transitions(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list comes from the
 * [VehiclesRepository]; both FSM feeds come from the [FsmRepository] (with the fixed web transition
 * arguments applied here). No HTTP touches the view.
 */
fun fsmDistributionSource(
    vehicles: VehiclesRepository,
    fsm: FsmRepository,
): FSMDistributionSource =
    object : FSMDistributionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun stats(vehicleId: String): Flow<Resource<JsonElement>> = fsm.stats(vehicleId)

        override fun transitions(vehicleId: String): Flow<Resource<JsonElement>> =
            fsm.transitions(vehicleId, TRANSITIONS_FSM_TYPE, TRANSITIONS_HOURS, TRANSITIONS_PAGE, TRANSITIONS_PER_PAGE)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. The store gates both FSM
 * feeds on a non-blank id (web `enabled: !!entityId`); the view-model only ever passes a resolved id. No
 * HTTP touches the view.
 */
fun fsmDistributionSource(
    vehicles: VehiclesStore,
    fsm: FsmStore,
): FSMDistributionSource =
    object : FSMDistributionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun stats(vehicleId: String): Flow<Resource<JsonElement>> = fsm.stats(vehicleId)

        override fun transitions(vehicleId: String): Flow<Resource<JsonElement>> =
            fsm.transitions(vehicleId, TRANSITIONS_FSM_TYPE, TRANSITIONS_HOURS, TRANSITIONS_PAGE, TRANSITIONS_PER_PAGE)
    }
