package io.teslasync.android.dashboard.widgets.mediahistory

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
 * Off-device verification of the MediaHistory data adapter — the `toMediaEntries` cache-then-network parse
 * (cached → projection, every freshness flag preserved) and the `mediaHistoryJsonResource` vehicle
 * resolution (web `vehicleId ?? vehicles?.[0]?.id`, with the no-vehicle disabled-query empty fold). No
 * Android framework, no network: the seam is driven by plain flows.
 */
class MediaHistorySourceTest {
    private fun mediaJson(
        id: Long,
        title: String,
    ): JsonElement =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("id", id)
                    put("now_playing_title", title)
                    put("now_playing_artist", "Queen")
                    put("playback_source", "spotify")
                    put("playback_status", "playing")
                    put("ts", "2026-06-06T12:00:00Z")
                },
            )
        }

    // ---- toMediaEntries: parse + freshness preservation -----------------------------

    @Test
    fun successParsesRowsAndKeepsStamp() {
        val parsed = Resource.Success(mediaJson(1, "Song"), fetchedAt = 100L, stale = false).toMediaEntries()
        assertTrue(parsed is Resource.Success)
        val success = parsed as Resource.Success
        assertEquals(1, success.data.size)
        assertEquals("Song", success.data.single().title)
        assertEquals(100L, success.fetchedAt)
    }

    @Test
    fun loadingPreservesCachedProjectionAndStamp() {
        val loading = Resource.Loading(cached = mediaJson(2, "Cached"), fetchedAt = 50L, stale = true).toMediaEntries()
        assertTrue(loading is Resource.Loading)
        val l = loading as Resource.Loading
        assertEquals("Cached", l.cached?.single()?.title)
        assertEquals(50L, l.fetchedAt)
        assertTrue(l.stale)
    }

    @Test
    fun errorPreservesCachedProjectionStaleAndCause() {
        val cause = ApiError.Timeout()
        val error = Resource.Error(cached = mediaJson(3, "Last"), fetchedAt = 70L, stale = true, error = cause).toMediaEntries()
        assertTrue(error is Resource.Error)
        val e = error as Resource.Error
        assertEquals("Last", e.cached?.single()?.title)
        assertTrue(e.stale)
        assertEquals(cause, e.error)
    }

    @Test
    fun nonArrayBodyParsesToEmptyList() {
        val parsed = Resource.Success(JsonArray(emptyList()), fetchedAt = 1L, stale = false).toMediaEntries()
        assertEquals(emptyList<MediaTrackEntry>(), (parsed as Resource.Success).data)
    }

    // ---- mediaHistoryJsonResource: vehicle resolution -------------------------------

    @Test
    fun explicitVehicleIdShortCircuitsToItsFeed() =
        runTest {
            var requestedId = -1L
            val result =
                mediaHistoryJsonResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(9)), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = 42L,
                    historyFor = { id ->
                        requestedId = id
                        flowOf(Resource.Success(mediaJson(1, "Song"), fetchedAt = 1L, stale = false))
                    },
                ).first()
            assertEquals(42L, requestedId)
            assertTrue(result is Resource.Success)
        }

    @Test
    fun firstEnrolledVehicleDrivesFeedWhenNoExplicitId() =
        runTest {
            var requestedId = -1L
            mediaHistoryJsonResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), fetchedAt = 1L, stale = false)),
                preferredVehicleId = null,
                historyFor = { id ->
                    requestedId = id
                    flowOf(Resource.Success(mediaJson(1, "Song"), fetchedAt = 1L, stale = false))
                },
            ).toList()
            assertEquals(7L, requestedId)
        }

    @Test
    fun noVehicleFoldsToEmptyHistorySuccess() =
        runTest {
            val result =
                mediaHistoryJsonResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(mediaJson(1, "Song"), fetchedAt = 1L, stale = false)) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(emptyList<MediaTrackEntry>(), result.toMediaEntries().let { (it as Resource.Success).data })
        }

    @Test
    fun fleetErrorWithNoVehiclePropagates() =
        runTest {
            val result =
                mediaHistoryJsonResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    historyFor = { flowOf(Resource.Success(mediaJson(1, "Song"), fetchedAt = 1L, stale = false)) },
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
