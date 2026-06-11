package io.teslasync.android.dashboard.widgets.sentryeventlog

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SentryEventLog data seam: the web `vehicleId ?? vehicles?.[0]?.id ?? 0`
 * resolution, the `sentryEventLogResource` composition (no-vehicle → empty snapshot, vehicle → mapped
 * `/security` rows, error → cache-preserving), and the raw-JSON → snapshot parse. No Android, no network.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SentryEventLogSourceTest {
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

    // ---- sentryEventLogResource composition ----------------------------------------

    @Test
    fun noVehicleEmitsEmptySnapshotSuccessWithoutQueryingSecurity() =
        runTest {
            val emissions =
                sentryEventLogResource(
                    vehicles = flowOf(Resource.Success<List<Vehicle>>(emptyList(), 1L, false)),
                    explicitVehicleId = null,
                    securityEvents = { error("security must not be queried without a vehicle") },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertFalse(last.cached!!.hasRows)
        }

    @Test
    fun resolvedVehicleMapsSecurityRowsToSnapshot() =
        runTest {
            var queriedId = -1L
            val emissions =
                sentryEventLogResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    securityEvents = { id ->
                        queriedId = id
                        flowOf(Resource.Success<JsonElement>(securityArray(), 9L, false))
                    },
                ).toList()

            assertEquals(7L, queriedId)
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertEquals(2, last.cached!!.events.size)
        }

    @Test
    fun explicitVehicleOverridesListForSecurityQuery() =
        runTest {
            var queriedId = -1L
            sentryEventLogResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                explicitVehicleId = 3L,
                securityEvents = { id ->
                    queriedId = id
                    flowOf(Resource.Success<JsonElement>(securityArray(), 9L, false))
                },
            ).toList()

            assertEquals(3L, queriedId)
        }

    @Test
    fun securityErrorPreservesCachedRowsAndFreshness() =
        runTest {
            val emissions =
                sentryEventLogResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    securityEvents = { flowOf(Resource.Error<JsonElement>(securityArray(), 9L, true, ApiError.Network())) },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Error)
            assertEquals(2, last.cached!!.events.size)
            assertTrue(last.stale)
        }

    // ---- toSentrySnapshot freshness preservation ------------------------------------

    @Test
    fun toSentrySnapshotPreservesVariantAndFreshness() {
        val success = Resource.Success<JsonElement>(securityArray(), 5L, false).toSentrySnapshot()
        assertTrue(success is Resource.Success && success.data.events.size == 2)

        val loading = Resource.Loading<JsonElement>(securityArray(), 6L, true).toSentrySnapshot()
        assertTrue(loading is Resource.Loading && loading.cached!!.hasRows && loading.stale)

        val error = Resource.Error<JsonElement>(securityArray(), 7L, true, ApiError.Timeout()).toSentrySnapshot()
        assertTrue(error is Resource.Error && error.cached!!.events.size == 2)
    }

    private fun securityArray() =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("id", 1)
                    put("vehicle_id", 7)
                    put("ts", "2024-01-15T10:00:00Z")
                    put("sentry_mode", true)
                },
            )
            add(
                buildJsonObject {
                    put("id", 2)
                    put("vehicle_id", 7)
                    put("ts", "2024-01-15T10:01:00Z")
                    put("locked", false)
                },
            )
        }
}
