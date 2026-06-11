package io.teslasync.android.dashboard.widgets.drivingcoach

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the [DrivingCoachSource] adapter seam — specifically [mapToReport], which
 * turns a raw `Resource<JsonElement>` cache-then-network emission into a `Resource<DrivingCoachReport>`.
 * Asserts the JSON body is parsed at the boundary AND every freshness flag (cached / fetchedAt / stale /
 * error) is preserved unchanged across Loading / Success / Error (ADR-013). This is the "cached →
 * projection" adapter contract the view-model and view rely on; kept pure so it needs no network or cache.
 */
class DrivingCoachSourceTest {
    private fun body(score: Int): JsonElement =
        buildJsonObject {
            put("overall_score", score)
            put("efficiency_wh_km", 160)
            put("best_efficiency_wh_km", 140)
        }

    @Test
    fun successParsesBodyAndPreservesFreshness() {
        val mapped = Resource.Success(body(87), fetchedAt = 100L, stale = false).mapToReport()
        assertTrue(mapped is Resource.Success)
        val success = mapped as Resource.Success
        assertTrue(success.data.hasData)
        assertEquals(87.0, success.data.overallScore, 0.0)
        assertEquals(100L, success.fetchedAt)
        assertFalse(success.stale)
    }

    @Test
    fun successWithEmptyBodyCollapsesToEmptyReport() {
        val mapped = Resource.Success(buildJsonObject { }, fetchedAt = 100L, stale = false).mapToReport()
        val success = mapped as Resource.Success
        assertFalse(success.data.hasData)
        assertEquals(DrivingCoachReport.Empty, success.data)
    }

    @Test
    fun loadingWithCachedParsesCachedAndPreservesStale() {
        val mapped = Resource.Loading(cached = body(64), fetchedAt = 50L, stale = true).mapToReport()
        val loading = mapped as Resource.Loading
        assertEquals(64.0, loading.cached?.overallScore)
        assertEquals(50L, loading.fetchedAt)
        assertTrue(loading.stale)
    }

    @Test
    fun loadingWithNullCachedStaysNull() {
        val mapped = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).mapToReport()
        assertNull((mapped as Resource.Loading).cached)
    }

    @Test
    fun errorWithCachedKeepsCachedAndError() {
        val mapped =
            Resource.Error(cached = body(72), fetchedAt = 50L, stale = true, error = ApiError.Network()).mapToReport()
        val error = mapped as Resource.Error
        assertEquals(72.0, error.cached?.overallScore)
        assertTrue(error.stale)
        assertTrue(error.error is ApiError.Network)
    }

    @Test
    fun errorWithNullCachedStaysNullAndKeepsError() {
        val source = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Timeout())
        val mapped = source.mapToReport()
        val error = mapped as Resource.Error
        assertNull(error.cached)
        assertTrue(error.error is ApiError.Timeout)
    }
}
