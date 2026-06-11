package io.teslasync.android.data.vehicles

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlin.time.Instant

internal val EPOCH: Instant = Instant.fromEpochMilliseconds(0)

/** Builds a fully-populated generated [Vehicle] for tests (every required field present). */
internal fun vehicle(
    id: Long,
    name: String = "Car $id",
): Vehicle =
    Vehicle(
        createdAt = EPOCH,
        displayName = name,
        enrolledAt = EPOCH,
        id = id,
        teslaId = id,
        timezone = "UTC",
        updatedAt = EPOCH,
        vin = "VIN$id",
    )

/**
 * A controllable fake [VehiclesRepository] standing in for the whole vehicles domain. The reads under
 * test ([vehicles], [vehicle], [vehicleState]) replay a configurable list of [Resource]s; the mutations
 * count calls and return configurable [Result]s. Every other read/mutation returns a benign default so
 * the real [io.teslasync.shared.core.presentation.vehicles.VehiclesStore] can be built over it.
 */
internal class FakeVehiclesRepository : VehiclesRepository {
    var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(Resource.Loading(null, null, false))
    var vehicleEmissions: List<Resource<Vehicle>> = listOf(Resource.Loading(null, null, false))
    var stateEmissions: List<Resource<VehicleStateEnvelope>> = listOf(Resource.Loading(null, null, false))

    var syncResult: Result<JsonElement> = Result.success(JsonNull)
    var wakeResult: Result<JsonElement> = Result.success(JsonNull)
    var refreshResult: Result<Vehicle> = Result.success(vehicle(1))

    var syncCalls = 0
        private set
    var wakeCalls = 0
        private set
    var refreshCalls = 0
        private set

    override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

    override fun vehicle(id: String): Flow<Resource<Vehicle>> = flow { vehicleEmissions.forEach { emit(it) } }

    override fun vehicleState(
        vehicleId: Long,
        asOf: String?,
    ): Flow<Resource<VehicleStateEnvelope>> = flow { stateEmissions.forEach { emit(it) } }

    override fun vehiclePositions(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> = jsonLoading()

    override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun motorHistory(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> = jsonLoading()

    override fun driveDynamicsLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun latestTirePressure(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun mediaLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun locationSnapshotLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleConfigLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun userPreferenceLatest(vehicleId: Long): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleMobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleOptions(vehicleId: String): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleSpecs(vehicleId: String): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleSubscriptions(vehicleId: String): Flow<Resource<JsonElement>> = jsonLoading()

    override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> = jsonLoading()

    override fun warrantyDetails(): Flow<Resource<JsonElement>> = jsonLoading()

    override suspend fun refreshVehicle(id: String): Result<Vehicle> {
        refreshCalls++
        return refreshResult
    }

    override suspend fun deleteVehicle(id: Long): Result<Unit> = Result.success(Unit)

    override suspend fun syncVehicles(): Result<JsonElement> {
        syncCalls++
        return syncResult
    }

    override suspend fun wakeVehicle(id: Long): Result<JsonElement> {
        wakeCalls++
        return wakeResult
    }

    override suspend fun refreshVehicleMobileEnabled(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleOptions(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleSpecs(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleSubscriptions(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshVehicleUpgrades(id: String): Result<JsonElement> = Result.success(JsonNull)

    override suspend fun refreshWarrantyDetails(): Result<JsonElement> = Result.success(JsonNull)

    private fun jsonLoading(): Flow<Resource<JsonElement>> = flow { emit(Resource.Loading(null, null, false)) }
}
