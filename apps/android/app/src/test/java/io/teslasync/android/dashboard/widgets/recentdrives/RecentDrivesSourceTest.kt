package io.teslasync.android.dashboard.widgets.recentdrives

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RecentDrives data seam: the web `vehicleId ?? vehicles?.[0]?.id ?? 0`
 * resolution ([resolveVehicleId]) and the [recentDrivesResource] composition (no-vehicle → empty-list
 * success, resolved/explicit vehicle → drive feed, list error → empty-state error). No Android, no network.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentDrivesSourceTest {
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

    // ---- recentDrivesResource composition ------------------------------------------

    @Test
    fun noVehicleEmitsEmptyListSuccess() =
        runTest {
            val emissions =
                recentDrivesResource(
                    vehicles = flowOf(Resource.Success<List<Vehicle>>(emptyList(), 1L, false)),
                    explicitVehicleId = null,
                    drives = { error("drives must not be queried without a vehicle") },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertTrue(last.cached!!.isEmpty())
        }

    @Test
    fun resolvedVehicleQueriesItsDriveFeed() =
        runTest {
            var queriedId = -1L
            val emissions =
                recentDrivesResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    drives = { id ->
                        queriedId = id
                        flowOf(Resource.Success<List<Drive>>(listOf(drive(id = 1)), 9L, false))
                    },
                ).toList()

            assertEquals(7L, queriedId)
            assertEquals(1, emissions.last().cached!!.size)
        }

    @Test
    fun explicitVehicleOverridesListForDriveQuery() =
        runTest {
            var queriedId = -1L
            recentDrivesResource(
                vehicles = flowOf(Resource.Loading<List<Vehicle>>(null, null, false)),
                explicitVehicleId = 3L,
                drives = { id ->
                    queriedId = id
                    flowOf(Resource.Success<List<Drive>>(listOf(drive(id = 1)), 9L, false))
                },
            ).toList()

            assertEquals(3L, queriedId)
        }

    @Test
    fun listErrorWithNoVehicleSurfacesAsErrorWithoutQueryingDrives() =
        runTest {
            val emissions =
                recentDrivesResource(
                    vehicles = flowOf(Resource.Error<List<Vehicle>>(null, 9L, true, ApiError.Network())),
                    explicitVehicleId = null,
                    drives = { error("drives must not be queried on a vehicle-list error") },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Error)
            assertTrue(last.stale)
        }
}
