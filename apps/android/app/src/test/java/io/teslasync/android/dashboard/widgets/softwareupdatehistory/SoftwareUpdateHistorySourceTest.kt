package io.teslasync.android.dashboard.widgets.softwareupdatehistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the SoftwareUpdateHistory data adapter — the `toSoftwareUpdates`
 * cache-then-network parse (cached → projection, every freshness flag preserved) and the
 * `softwareUpdatesJsonResource` vehicle resolution (web `vehicleId ?? vehicles?.[0]?.id`, with the
 * no-vehicle disabled-query empty fold). No Android framework, no network: the seam is driven by plain
 * flows.
 */
class SoftwareUpdateHistorySourceTest {
    private fun updateJson(
        id: Long,
        version: String,
    ): JsonElement =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("id", id)
                    put("version", version)
                    put("status", "installed")
                    put("installed_at", "2026-06-06T12:00:00Z")
                    put("created_at", "2026-06-01T00:00:00Z")
                },
            )
        }

    // ---- toSoftwareUpdates: parse + freshness preservation --------------------------

    @Test
    fun successParsesRowsAndKeepsStamp() {
        val parsed = Resource.Success(updateJson(1, "2026.20.5"), fetchedAt = 100L, stale = false).toSoftwareUpdates()
        assertTrue(parsed is Resource.Success)
        val success = parsed as Resource.Success
        assertEquals(1, success.data.size)
        assertEquals("2026.20.5", success.data.single().version)
        assertEquals(100L, success.fetchedAt)
    }

    @Test
    fun loadingPreservesCachedProjectionAndStamp() {
        val loading = Resource.Loading(cached = updateJson(2, "2026.8.1"), fetchedAt = 50L, stale = true).toSoftwareUpdates()
        assertTrue(loading is Resource.Loading)
        val l = loading as Resource.Loading
        assertEquals("2026.8.1", l.cached?.single()?.version)
        assertEquals(50L, l.fetchedAt)
        assertTrue(l.stale)
    }

    @Test
    fun errorPreservesCachedProjectionStaleAndCause() {
        val cause = ApiError.Timeout()
        val error = Resource.Error(cached = updateJson(3, "2026.2.0"), fetchedAt = 70L, stale = true, error = cause).toSoftwareUpdates()
        assertTrue(error is Resource.Error)
        val e = error as Resource.Error
        assertEquals("2026.2.0", e.cached?.single()?.version)
        assertTrue(e.stale)
        assertEquals(cause, e.error)
    }

    @Test
    fun nonArrayBodyParsesToEmptyList() {
        val parsed = Resource.Success(JsonArray(emptyList()), fetchedAt = 1L, stale = false).toSoftwareUpdates()
        assertEquals(emptyList<SoftwareUpdateEntry>(), (parsed as Resource.Success).data)
    }

    // ---- softwareUpdatesJsonResource: vehicle resolution ----------------------------

    @Test
    fun explicitVehicleIdShortCircuitsToItsFeed() =
        runTest {
            var requestedId = -1L
            val result =
                softwareUpdatesJsonResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(9)), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = 42L,
                    historyFor = { id ->
                        requestedId = id
                        flowOf(Resource.Success(updateJson(1, "2026.20.5"), fetchedAt = 1L, stale = false))
                    },
                ).first()
            assertEquals(42L, requestedId)
            assertTrue(result is Resource.Success)
        }

    @Test
    fun firstEnrolledVehicleDrivesFeedWhenNoExplicitId() =
        runTest {
            var requestedId = -1L
            softwareUpdatesJsonResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), fetchedAt = 1L, stale = false)),
                preferredVehicleId = null,
                historyFor = { id ->
                    requestedId = id
                    flowOf(Resource.Success(updateJson(1, "2026.20.5"), fetchedAt = 1L, stale = false))
                },
            ).toList()
            assertEquals(7L, requestedId)
        }

    @Test
    fun noVehicleFoldsToEmptyHistorySuccess() =
        runTest {
            val result =
                softwareUpdatesJsonResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(updateJson(1, "2026.20.5"), fetchedAt = 1L, stale = false)) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(emptyList<SoftwareUpdateEntry>(), result.toSoftwareUpdates().let { (it as Resource.Success).data })
        }

    @Test
    fun fleetErrorWithNoVehiclePropagates() =
        runTest {
            val result =
                softwareUpdatesJsonResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(updateJson(1, "2026.20.5"), fetchedAt = 1L, stale = false)) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
