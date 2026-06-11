package io.teslasync.android.dashboard.widgets.tirepressurehistory

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TirePressureHistory data seam: the web `vehicleId ?? vehicles?.[0]?.id
 * ?? 0` resolution and the `tirePressureHistoryResource` composition (no-vehicle → empty snapshot,
 * vehicle → mapped history, error → cache-preserving). No Android, no network.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TirePressureHistorySourceTest {
    // ---- resolveVehicleId (web `vehicleId ?? vehicles?.[0]?.id ?? 0`) --------------

    @Test
    fun explicitVehicleIdWinsOverList() {
        assertEquals(5L, resolveVehicleId(5L, listOf(vehicle(7), vehicle(8))))
    }

    @Test
    fun firstEnrolledVehicleUsedWhenNoExplicitId() {
        assertEquals(7L, resolveVehicleId(null, listOf(vehicle(7), vehicle(8))))
    }

    @Test
    fun zeroSentinelWhenNoVehicleResolves() {
        assertEquals(0L, resolveVehicleId(null, emptyList()))
        assertEquals(0L, resolveVehicleId(null, null))
    }

    // ---- tirePressureHistoryResource composition -----------------------------------

    @Test
    fun noVehicleEmitsEmptySnapshotSuccess() =
        runTest {
            val emissions =
                tirePressureHistoryResource(
                    vehicles = flowOf(Resource.Success<List<Vehicle>>(emptyList(), 1L, false)),
                    explicitVehicleId = null,
                    history = { error("history must not be queried without a vehicle") },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertFalse(last.cached!!.hasData)
        }

    @Test
    fun resolvedVehicleMapsHistoryRowsToSnapshot() =
        runTest {
            var queriedId = -1L
            val emissions =
                tirePressureHistoryResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    history = { id ->
                        queriedId = id
                        flowOf(Resource.Success<JsonElement>(tireArray(), 9L, false))
                    },
                ).toList()

            assertEquals(7L, queriedId)
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertEquals(2, last.cached!!.points.size)
        }

    @Test
    fun explicitVehicleOverridesListForHistoryQuery() =
        runTest {
            var queriedId = -1L
            tirePressureHistoryResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                explicitVehicleId = 3L,
                history = { id ->
                    queriedId = id
                    flowOf(Resource.Success<JsonElement>(tireArray(), 9L, false))
                },
            ).toList()

            assertEquals(3L, queriedId)
        }

    @Test
    fun historyErrorPreservesCachedRowsAndFreshness() =
        runTest {
            val emissions =
                tirePressureHistoryResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    history = { flowOf(Resource.Error<JsonElement>(tireArray(), 9L, true, ApiError.Network())) },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Error)
            assertEquals(2, last.cached!!.points.size)
            assertTrue(last.stale)
        }

    private fun tireArray(): JsonElement =
        tireHistoryJson(
            listOf(
                TireRow(ts = "2024-06-11T08:00:00Z", frontLeft = 230000.0),
                TireRow(ts = "2024-06-11T09:00:00Z", frontLeft = 240000.0),
            ),
        )
}
