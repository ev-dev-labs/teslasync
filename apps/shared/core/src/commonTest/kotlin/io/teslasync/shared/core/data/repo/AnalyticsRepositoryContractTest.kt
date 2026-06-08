package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Locks every [HttpAnalyticsRepository] call to the exact endpoint/method/params the web
 * `useAnalytics` hooks issue, and verifies the `select`-derivation reads unwrap/guard their
 * payload to an array before caching. A path/param/derivation regression is caught at build
 * time instead of as a silent always-empty Analytics screen in production.
 */
class AnalyticsRepositoryContractTest {
    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        onUrl: (Url) -> Unit = {},
    ): HttpAnalyticsRepository {
        val engine =
            MockEngine { request ->
                onUrl(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAnalyticsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpAnalyticsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    private suspend fun lastSuccess(
        body: String,
        call: (HttpAnalyticsRepository) -> Flow<Resource<*>>,
    ): String {
        val emissions = call(repo(body = body)).toList()
        return (emissions.last() as Resource.Success).data.toString()
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun analyticsSummaryHitsFleetWithDays() =
        runTestBlocking {
            val url = captureRead { it.analyticsSummary(30) }
            assertEquals("/api/v1/analytics/fleet", url.encodedPath)
            assertEquals("30", url.parameters["days"])
        }

    @Test
    fun fleetAnalyticsNoBoundsSendsNoQuery() =
        runTestBlocking {
            val url = captureRead { it.fleetAnalytics() }
            assertEquals("/api/v1/analytics/fleet", url.encodedPath)
            assertNull(url.parameters["days"])
            assertNull(url.parameters["start"])
            assertNull(url.parameters["end"])
        }

    @Test
    fun fleetAnalyticsRangeWinsOverDays() =
        runTestBlocking {
            val url = captureRead { it.fleetAnalytics(days = 30, start = "2026-01-01", end = "2026-02-01") }
            assertEquals("2026-01-01", url.parameters["start"])
            assertEquals("2026-02-01", url.parameters["end"])
            // start/end present ⇒ days is suppressed, mirroring the web precedence.
            assertNull(url.parameters["days"])
        }

    @Test
    fun fleetAnalyticsDaysOnlyWhenNoRange() =
        runTestBlocking {
            val url = captureRead { it.fleetAnalytics(days = 7) }
            assertEquals("7", url.parameters["days"])
            assertNull(url.parameters["start"])
        }

    @Test
    fun mileageStatsHitsMileageStatsWithVehicleId() =
        runTestBlocking {
            val url = captureRead { it.mileageStats("7") }
            assertEquals("/api/v1/mileage/stats", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun monthlyMileageHitsMileageMonthlyWithVehicleId() =
        runTestBlocking {
            val url = captureRead("{\"vehicle_id\":7,\"months\":[]}") { it.monthlyMileage("7") }
            assertEquals("/api/v1/mileage/monthly", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun dailyMileageHitsMileageDailyWithVehicleIdAndDays() =
        runTestBlocking {
            val url = captureRead("{\"vehicle_id\":7,\"days\":[]}") { it.dailyMileage("7", days = 45) }
            assertEquals("/api/v1/mileage/daily", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("45", url.parameters["days"])
        }

    @Test
    fun costBreakdownHitsAnalyticsTcoWithVehicleId() =
        runTestBlocking {
            val url = captureRead { it.costBreakdown("7") }
            assertEquals("/api/v1/analytics/tco", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun timelineHitsVehicleStatesTimelineWithVehicleId() =
        runTestBlocking {
            val url = captureRead("{\"transitions\":[]}") { it.timeline("7") }
            assertEquals("/api/v1/vehicle-states/timeline", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            // Web parity: the timeline read carries NO `days` param (unlike the admin variant).
            assertNull(url.parameters["days"])
        }

    @Test
    fun stateSummaryHitsVehicleStatesSummaryWithVehicleId() =
        runTestBlocking {
            val url = captureRead("[]") { it.stateSummary("7") }
            assertEquals("/api/v1/vehicle-states/summary", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun weeklyDigestHitsPerVehicleWeeklyDigest() =
        runTestBlocking {
            val url = captureRead { it.weeklyDigest("7") }
            assertEquals("/api/v1/vehicles/7/weekly-digest", url.encodedPath)
        }

    @Test
    fun lifetimeStatsOmitsVehicleIdWhenNull() =
        runTestBlocking {
            val url = captureRead { it.lifetimeStats(null) }
            assertEquals("/api/v1/analytics/lifetime", url.encodedPath)
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun lifetimeStatsIncludesVehicleIdWhenPresent() =
        runTestBlocking {
            val url = captureRead { it.lifetimeStats("7") }
            assertEquals("/api/v1/analytics/lifetime", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun lifetimeStatsOmitsVehicleIdWhenBlank() =
        runTestBlocking {
            // Web `vehicleId ? … : ''` treats an empty string as falsy ⇒ no param.
            val url = captureRead { it.lifetimeStats("") }
            assertEquals("/api/v1/analytics/lifetime", url.encodedPath)
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun yearReviewSendsYearAndOmitsVehicleIdWhenNull() =
        runTestBlocking {
            val url = captureRead { it.yearReview(2026, null) }
            assertEquals("/api/v1/analytics/year-review", url.encodedPath)
            assertEquals("2026", url.parameters["year"])
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun yearReviewIncludesVehicleIdWhenPresent() =
        runTestBlocking {
            val url = captureRead { it.yearReview(2026, "7") }
            assertEquals("2026", url.parameters["year"])
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun yearReviewOmitsVehicleIdWhenBlank() =
        runTestBlocking {
            val url = captureRead { it.yearReview(2026, "") }
            assertEquals("2026", url.parameters["year"])
            assertNull(url.parameters["vehicle_id"])
        }

    // ---- Reads: derivations (unwrap / safeArray) ----------------------------------

    @Test
    fun monthlyMileageUnwrapsMonthsEnvelopeToArray() =
        runTestBlocking {
            val out = lastSuccess("{\"vehicle_id\":7,\"months\":[{\"m\":1}]}") { it.monthlyMileage("7") }
            assertEquals("[{\"m\":1}]", out)
        }

    @Test
    fun monthlyMileageMissingEnvelopeCollapsesToEmptyArray() =
        runTestBlocking {
            val out = lastSuccess("{\"vehicle_id\":7}") { it.monthlyMileage("7") }
            assertEquals("[]", out)
        }

    @Test
    fun dailyMileageUnwrapsDaysEnvelopeToArray() =
        runTestBlocking {
            val out = lastSuccess("{\"vehicle_id\":7,\"days\":[{\"d\":1}]}") { it.dailyMileage("7") }
            assertEquals("[{\"d\":1}]", out)
        }

    @Test
    fun timelineUnwrapsTransitionsEnvelopeToArray() =
        runTestBlocking {
            val out = lastSuccess("{\"transitions\":[{\"to\":\"drive\"}]}") { it.timeline("7") }
            assertEquals("[{\"to\":\"drive\"}]", out)
        }

    @Test
    fun stateSummaryCoercesNonArrayToEmptyArray() =
        runTestBlocking {
            val out = lastSuccess("{\"unexpected\":true}") { it.stateSummary("7") }
            assertEquals("[]", out)
        }
}
