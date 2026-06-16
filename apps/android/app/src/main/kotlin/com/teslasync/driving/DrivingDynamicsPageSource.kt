// The data seam the DrivingDynamicsPage surface binds to, plus its production binding over the shared S8 holders
// and page-local cache-then-network repositories for the reads the app DI graph does not yet expose as stores.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's reads: `useMotorLatest` (`/motor/latest`), `useMotorHistory` (`/motor`),
// `useDriveDynamicsLatest` (`/drive-dynamics/latest`), `useDrives` (`/drives`), `useDrivingCoach`
// (`/analytics/driving-coach`) and the global `useSelectedVehicle` scope. The autopilot sub-panel's three reads
// (`useVehicleState` + two `useSignalObservations`) are bound through the shared [AutopilotSectionSource].
//
// The three vehicle feeds (motor latest/history, drive-dynamics) are the shared-core cache-then-network
// `Resource` streams the S8 [VehiclesStore] already exposes; the active-vehicle scope is the app-scoped
// [SelectedVehicleStore]. The two driving feeds (`/drives`, `/analytics/driving-coach`) have no store in the
// Android DI graph yet, so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpDrivingRepository]
// over the SAME resilient client + offline cache (so the ADR-013 freshness contract + SI-verbatim caching are
// identical) and hands it in here; the autopilot cruise observations come from a page-local
// [io.teslasync.shared.core.data.repo.HttpTelemetryRepository] the same way. A narrow seam so the view-model
// depends on an abstraction (real adapters ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.drivingdynamics

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.featureviews.autopilotsection.AutopilotSectionSource
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** The `CruiseSetSpeed` signal field read for the cruise set-speed tile (web `signal_name: 'CruiseSetSpeed'`). */
private const val SIGNAL_CRUISE_SET_SPEED: String = "CruiseSetSpeed"

/** The `CruiseFollowDistance` signal field read for the follow-distance tile (web `'CruiseFollowDistance'`). */
private const val SIGNAL_CRUISE_FOLLOW_DISTANCE: String = "CruiseFollowDistance"

/** Both cruise observation feeds request only the most recent row (web `{ limit: 1 }`). */
private const val OBSERVATION_LIMIT: Int = 1

/**
 * The single seam the [DrivingDynamicsPageViewModel] depends on so it binds to an abstraction (the shared
 * Vehicles holder, page-local Driving + Telemetry repositories, and the app-scoped selection in production; a
 * fake in tests), never to a concrete store or the network. Every read feed is a cache-then-network `Resource`
 * flow (the web read hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface DrivingDynamicsPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /motor/latest` feed for [vehicleId] (web `useMotorLatest`). */
    fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /motor` history feed for [vehicleId] (web `useMotorHistory`, limit 200). */
    fun motorHistory(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drive-dynamics/latest` feed for [vehicleId] (web `useDriveDynamicsLatest`). */
    fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drives` feed for [vehicleId] (web `useDrives`), decoded to SI [Drive]s. */
    fun drives(vehicleId: String): Flow<Resource<List<Drive>>>

    /** The cache-then-network `GET /analytics/driving-coach` feed for [vehicleId] (web `useDrivingCoach`). */
    fun drivingCoach(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The data port the AutopilotSection sub-panel binds to (web `useVehicleState` + two `useSignalObservations`).
     * The panel owns its own view-model + lifecycle; this only supplies the shared feeds it reads.
     */
    fun autopilotSource(): AutopilotSectionSource
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + a page-local [DrivingRepository] + a page-local
 * [TelemetryRepository] + the app-scoped [SelectedVehicleStore] — the memoized, multi-observer feeds the rest of
 * the app shares plus the cache-then-network repositories every other surface reuses. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun drivingDynamicsPageSourceOf(
    vehiclesStore: VehiclesStore,
    drivingRepository: DrivingRepository,
    telemetryRepository: TelemetryRepository,
    selectedVehicleStore: SelectedVehicleStore,
): DrivingDynamicsPageSource =
    object : DrivingDynamicsPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = vehiclesStore.motorLatest(vehicleId)

        override fun motorHistory(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesStore.motorHistory(vehicleId, DrivingDynamicsPageRegistration.MOTOR_HISTORY_LIMIT)

        override fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesStore.driveDynamicsLatest(vehicleId)

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> = drivingRepository.drives(vehicleId)

        override fun drivingCoach(vehicleId: String): Flow<Resource<JsonElement>> = drivingRepository.drivingCoach(vehicleId)

        override fun autopilotSource(): AutopilotSectionSource =
            object : AutopilotSectionSource {
                override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

                override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
                    vehiclesStore.vehicleState(vehicleId)

                override fun cruiseSetSpeed(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
                    telemetryRepository.signalObservations(
                        SignalObservationsParams(vehicleId = vehicleId, signalName = SIGNAL_CRUISE_SET_SPEED, limit = OBSERVATION_LIMIT),
                    )

                override fun followDistance(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
                    telemetryRepository.signalObservations(
                        SignalObservationsParams(
                            vehicleId = vehicleId,
                            signalName = SIGNAL_CRUISE_FOLLOW_DISTANCE,
                            limit = OBSERVATION_LIMIT,
                        ),
                    )
            }
    }
