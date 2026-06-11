package io.teslasync.android.dashboard.widgets.safetyhistory

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
 * Off-device verification of the SafetyHistory data adapter — the `toSafetyEntries` cache-then-network
 * parse (cached → projection, every freshness flag preserved) and the `safetyHistoryJsonResource` vehicle
 * resolution (web `vehicleId ?? vehicles?.[0]?.id`, with the no-vehicle disabled-query empty fold). No
 * Android framework, no network: the seam is driven by plain flows.
 */
class SafetyHistorySourceTest {
    private fun safetyJson(
        id: Long,
        aebOff: Boolean,
    ): JsonElement =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("id", id)
                    put("created_at", "2026-06-06T12:00:00Z")
                    put("automatic_emergency_braking_off", aebOff)
                },
            )
        }

    // ---- toSafetyEntries: parse + freshness preservation ----------------------------

    @Test
    fun successParsesRowsAndKeepsStamp() {
        val parsed = Resource.Success(safetyJson(1, aebOff = true), fetchedAt = 100L, stale = false).toSafetyEntries()
        assertTrue(parsed is Resource.Success)
        val success = parsed as Resource.Success
        assertEquals(1, success.data.size)
        assertEquals(SafetyEventType.Aeb, SafetyHistoryProjection.classify(success.data.single()))
        assertEquals(100L, success.fetchedAt)
    }

    @Test
    fun loadingPreservesCachedProjectionAndStamp() {
        val loading = Resource.Loading(cached = safetyJson(2, aebOff = true), fetchedAt = 50L, stale = true).toSafetyEntries()
        assertTrue(loading is Resource.Loading)
        val l = loading as Resource.Loading
        assertEquals(2L, l.cached?.single()?.id)
        assertEquals(50L, l.fetchedAt)
        assertTrue(l.stale)
    }

    @Test
    fun errorPreservesCachedProjectionStaleAndCause() {
        val cause = ApiError.Timeout()
        val error = Resource.Error(cached = safetyJson(3, aebOff = false), fetchedAt = 70L, stale = true, error = cause).toSafetyEntries()
        assertTrue(error is Resource.Error)
        val e = error as Resource.Error
        assertEquals(3L, e.cached?.single()?.id)
        assertTrue(e.stale)
        assertEquals(cause, e.error)
    }

    @Test
    fun nonArrayBodyParsesToEmptyList() {
        val parsed = Resource.Success(JsonArray(emptyList()), fetchedAt = 1L, stale = false).toSafetyEntries()
        assertEquals(emptyList<SafetyEntry>(), (parsed as Resource.Success).data)
    }

    // ---- safetyHistoryJsonResource: vehicle resolution ------------------------------

    @Test
    fun explicitVehicleIdShortCircuitsToItsFeed() =
        runTest {
            var requestedId = -1L
            val result =
                safetyHistoryJsonResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(9)), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = 42L,
                    historyFor = { id ->
                        requestedId = id
                        flowOf(Resource.Success(safetyJson(1, aebOff = true), fetchedAt = 1L, stale = false))
                    },
                ).first()
            assertEquals(42L, requestedId)
            assertTrue(result is Resource.Success)
        }

    @Test
    fun firstEnrolledVehicleDrivesFeedWhenNoExplicitId() =
        runTest {
            var requestedId = -1L
            safetyHistoryJsonResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), fetchedAt = 1L, stale = false)),
                preferredVehicleId = null,
                historyFor = { id ->
                    requestedId = id
                    flowOf(Resource.Success(safetyJson(1, aebOff = true), fetchedAt = 1L, stale = false))
                },
            ).toList()
            assertEquals(7L, requestedId)
        }

    @Test
    fun noVehicleFoldsToEmptyHistorySuccess() =
        runTest {
            val result =
                safetyHistoryJsonResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(safetyJson(1, aebOff = true), fetchedAt = 1L, stale = false)) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(emptyList<SafetyEntry>(), result.toSafetyEntries().let { (it as Resource.Success).data })
        }

    @Test
    fun fleetErrorWithNoVehiclePropagates() =
        runTest {
            val result =
                safetyHistoryJsonResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(safetyJson(1, aebOff = true), fetchedAt = 1L, stale = false)) },
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
