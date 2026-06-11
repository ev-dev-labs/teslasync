package io.teslasync.android.dashboard.widgets.vampiredrain

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VampireDrain data seam: the web `vehicleId ?? vehicles?.[0]?.id`
 * resolution, the `vampireDrainResource` composition (no-vehicle → empty snapshot, vehicle → combined
 * stats + events), and the [combineVampireDrain] freshness fold that reproduces the web widget's combined
 * `isLoading` / `hasData` / `isStale` / `isError` / `updatedAt` semantics across the two queries. No
 * Android, no network.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VampireDrainSourceTest {
    // ---- resolveVehicleId (web `vehicleId ?? vehicles?.[0]?.id`) ---------------------

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

    // ---- vampireDrainResource composition -------------------------------------------

    @Test
    fun noVehicleEmitsEmptySnapshotWithoutQueryingEnergy() =
        runTest {
            val emissions =
                vampireDrainResource(
                    vehicles = flowOf(Resource.Success<List<Vehicle>>(emptyList(), 1L, false)),
                    explicitVehicleId = null,
                    stats = { error("stats must not be queried without a vehicle") },
                    events = { error("events must not be queried without a vehicle") },
                ).toList()

            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertFalse(last.cached!!.hasData)
        }

    @Test
    fun resolvedVehicleCombinesStatsAndEventsForThatId() =
        runTest {
            var statsId = -1L
            var eventsId = -1L
            val emissions =
                vampireDrainResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                    explicitVehicleId = null,
                    stats = { id ->
                        statsId = id
                        flowOf(Resource.Success<JsonElement>(statsJson(), 9L, false))
                    },
                    events = { id ->
                        eventsId = id
                        flowOf(Resource.Success<JsonElement>(eventsJson(), 9L, false))
                    },
                ).toList()

            assertEquals(7L, statsId)
            assertEquals(7L, eventsId)
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertEquals(2, last.cached!!.events.size)
            assertEquals(0.1, requireNotNull(last.cached!!.stats).avgDrainRate, EPS)
        }

    @Test
    fun explicitVehicleOverridesListForEnergyQueries() =
        runTest {
            var statsId = -1L
            vampireDrainResource(
                vehicles = flowOf(Resource.Success(listOf(vehicle(7)), 1L, false)),
                explicitVehicleId = 3L,
                stats = { id ->
                    statsId = id
                    flowOf(Resource.Success<JsonElement>(statsJson(), 9L, false))
                },
                events = { flowOf(Resource.Success<JsonElement>(eventsJson(), 9L, false)) },
            ).toList()

            assertEquals(3L, statsId)
        }

    // ---- combineVampireDrain freshness fold -----------------------------------------

    @Test
    fun combine_bothFirstLoadingStaysLoadingWithNoCache() {
        val combined = combineVampireDrain(loading(), loading())
        assertTrue(combined is Resource.Loading)
        assertNull(combined.cached)
    }

    @Test
    fun combine_oneFeedStillFirstLoadingKeepsWholeWidgetLoading() {
        // web `isLoading = statsLoading || eventsLoading` — a skeleton until BOTH first loads settle.
        val combined = combineVampireDrain(loading(), Resource.Success(eventsJson(), 5L, false))
        assertTrue(combined is Resource.Loading)
        assertNull(combined.cached)
    }

    @Test
    fun combine_bothSuccessProducesCombinedSnapshot() {
        val combined = combineVampireDrain(Resource.Success(statsJson(), 5L, false), Resource.Success(eventsJson(), 9L, false))
        assertTrue(combined is Resource.Success)
        val snapshot = (combined as Resource.Success).data
        assertEquals(0.1, requireNotNull(snapshot.stats).avgDrainRate, EPS)
        assertEquals(2, snapshot.events.size)
        // updatedAt = max(statsUpdatedAt, eventsUpdatedAt).
        assertEquals(9L, combined.fetchedAt)
    }

    @Test
    fun combine_hardErrorWithNoCacheCollapsesToCachelessError() {
        // Both deprecated routes 404 with nothing cached ⇒ a cache-less error the view renders as the
        // friendly empty state + error chip (web parity: never a blanking hard-error body).
        val combined =
            combineVampireDrain(
                Resource.Error(null, null, false, ApiError.Http(404)),
                Resource.Error(null, null, false, ApiError.Http(404)),
            )
        assertTrue(combined is Resource.Error)
        assertNull(combined.cached)
    }

    @Test
    fun combine_errorWithCachedDataKeepsOfflineSnapshot() {
        val combined =
            combineVampireDrain(
                Resource.Error(statsJson(), 5L, true, ApiError.Network()),
                Resource.Success(eventsJson(), 9L, false),
            )
        assertTrue(combined is Resource.Error)
        assertTrue(combined.stale)
        val cached = requireNotNull(combined.cached)
        assertTrue(cached.hasData)
        assertEquals(2, cached.events.size)
    }

    @Test
    fun combine_refreshInFlightKeepsCachedSnapshot() {
        val combined =
            combineVampireDrain(
                Resource.Success(statsJson(), 5L, false),
                Resource.Loading(eventsJson(), 9L, false),
            )
        assertTrue(combined is Resource.Loading)
        val cached = requireNotNull(combined.cached)
        assertEquals(0.1, requireNotNull(cached.stats).avgDrainRate, EPS)
    }

    @Test
    fun combine_statsPresentWithNoEventsStillHasData() {
        // web hasData = stats != null || events.length > 0 — a stats card alone satisfies content.
        val combined =
            combineVampireDrain(
                Resource.Success(statsJson(), 5L, false),
                Resource.Success(emptyEventsJson(), 9L, false),
            )
        assertTrue(combined is Resource.Success)
        val snapshot = (combined as Resource.Success).data
        assertTrue(snapshot.hasData)
        assertTrue(snapshot.events.isEmpty())
    }

    private fun statsJson(): JsonElement =
        buildJsonObject {
            put("avg_drain_rate", 0.1)
            put("total_hours", 10)
            put("event_count", 2)
        }

    private fun eventsJson(): JsonElement =
        buildJsonArray {
            add(
                buildJsonObject {
                    put("id", 1)
                    put("start_date", "2026-06-06T10:00:00Z")
                    put("duration_hours", 2.5)
                    put("battery_lost", 5)
                    put("drain_rate_pct_per_hour", 2.5)
                    put("sentry_mode", true)
                },
            )
            add(
                buildJsonObject {
                    put("id", 2)
                    put("start_date", "2026-06-06T08:00:00Z")
                    put("duration_hours", 0.5)
                    put("battery_lost", 1)
                    put("drain_rate_pct_per_hour", 0.5)
                    put("sentry_mode", false)
                },
            )
        }

    private fun emptyEventsJson(): JsonElement = buildJsonArray { }

    private fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private companion object {
        const val EPS = 1e-9
    }
}
