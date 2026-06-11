package io.teslasync.android.featureviews.httpstatus

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure (off-device) tests for the HttpStatusTool catalog, the status-class → badge classification (the web
 * Badge-variant ternary), the search + sort projection ([HttpStatusProjection] — the web `filtered` memo +
 * the sortable code column), and the cache-then-network data adapter ([httpStatusResource] /
 * [httpStatusToolSource] — cached list → snapshot projection), covering the loading / success / empty /
 * error / offline envelope folding.
 */
class HttpStatusToolProjectionTest {
    // ── catalog ─────────────────────────────────────────────────────────────────────

    @Test
    fun catalogReproducesTheNineteenWebCodesInOrder() {
        val codes = HttpStatusCatalog.codes
        assertEquals(19, codes.size)
        assertEquals(
            listOf(200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 504),
            codes.map { it.code },
        )
        assertEquals("OK", codes.first().text)
        assertEquals("Request succeeded", codes.first().desc)
        assertEquals("Gateway Timeout", codes.last().text)
    }

    // ── badge classification (web Badge variant ternary) ──────────────────────────────

    @Test
    fun badgeClassificationMatchesTheWebVariantTernary() {
        assertEquals(HttpStatusClass.Success, HttpStatusClass.forCode(200))
        assertEquals(HttpStatusClass.Success, HttpStatusClass.forCode(299))
        assertEquals(HttpStatusClass.Info, HttpStatusClass.forCode(300))
        assertEquals(HttpStatusClass.Info, HttpStatusClass.forCode(399))
        assertEquals(HttpStatusClass.Warning, HttpStatusClass.forCode(400))
        assertEquals(HttpStatusClass.Warning, HttpStatusClass.forCode(499))
        assertEquals(HttpStatusClass.Danger, HttpStatusClass.forCode(500))
        assertEquals(HttpStatusClass.Danger, HttpStatusClass.forCode(504))
    }

    @Test
    fun statusClassIsExposedPerRow() {
        assertEquals(HttpStatusClass.Success, HttpStatusCode(200, "OK", "").statusClass)
        assertEquals(HttpStatusClass.Info, HttpStatusCode(301, "Moved", "").statusClass)
        assertEquals(HttpStatusClass.Warning, HttpStatusCode(404, "Not Found", "").statusClass)
        assertEquals(HttpStatusClass.Danger, HttpStatusCode(503, "Unavailable", "").statusClass)
    }

    // ── search projection (web `filtered`) ────────────────────────────────────────────

    @Test
    fun blankQueryReturnsTheCatalogUnchanged() {
        val all = HttpStatusCatalog.codes
        // The blank-query fast path returns the same list instance (web `return HTTP_CODES`).
        assertSame(all, HttpStatusProjection.filter(all, "").codes)
        assertSame(all, HttpStatusProjection.filter(all, "   ").codes)
    }

    @Test
    fun queryMatchesOnCodeSubstring() {
        val display = HttpStatusProjection.filter(HttpStatusCatalog.codes, "40")
        // Only codes whose digit string contains "40" — note 304 does NOT (no "40" substring).
        assertEquals(listOf(400, 401, 403, 404, 405, 408, 409), display.codes.map { it.code })
        assertTrue(display.hasResults)
    }

    @Test
    fun queryMatchesOnReasonPhraseCaseInsensitively() {
        val display = HttpStatusProjection.filter(HttpStatusCatalog.codes, "TIMEOUT")
        assertEquals(listOf(408, 504), display.codes.map { it.code })
    }

    @Test
    fun queryMatchesOnDescription() {
        val display = HttpStatusProjection.filter(HttpStatusCatalog.codes, "cached")
        assertEquals(listOf(304), display.codes.map { it.code })
    }

    @Test
    fun noMatchYieldsEmptyResults() {
        val display = HttpStatusProjection.filter(HttpStatusCatalog.codes, "zzz-nothing")
        assertTrue(display.codes.isEmpty())
        assertFalse(display.hasResults)
    }

    // ── sort projection (web sortable code column) ────────────────────────────────────

    @Test
    fun defaultSortPreservesCatalogOrder() {
        val codes = HttpStatusCatalog.codes
        // SortState() has a null key → unsorted → the same list instance is returned.
        assertSame(codes, HttpStatusProjection.sorted(codes, SortState()))
    }

    @Test
    fun ascendingSortOrdersByCode() {
        val sample = listOf(HttpStatusCode(500, "a", ""), HttpStatusCode(200, "b", ""), HttpStatusCode(404, "c", ""))
        val out = HttpStatusProjection.sorted(sample, SortState(HttpStatusColumns.CODE, SortDirection.Asc))
        assertEquals(listOf(200, 404, 500), out.map { it.code })
    }

    @Test
    fun descendingSortOrdersByCode() {
        val sample = listOf(HttpStatusCode(200, "b", ""), HttpStatusCode(500, "a", ""), HttpStatusCode(404, "c", ""))
        val out = HttpStatusProjection.sorted(sample, SortState(HttpStatusColumns.CODE, SortDirection.Desc))
        assertEquals(listOf(500, 404, 200), out.map { it.code })
    }

    @Test
    fun nonCodeSortKeyPreservesNaturalOrder() {
        val codes = HttpStatusCatalog.codes
        // Only the code column is sortable (web); a text-column key is a no-op.
        assertSame(codes, HttpStatusProjection.sorted(codes, SortState(HttpStatusColumns.TEXT, SortDirection.Asc)))
    }

    // ── data adapter (cached → snapshot) ──────────────────────────────────────────────

    @Test
    fun adapterFoldsSuccessIntoSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(HttpStatusCatalog.codes, fetchedAt = 5L, stale = false)))
            val result = httpStatusResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(19, result.cached?.codes?.size)
            assertFalse(result.cached!!.isEmpty)
        }

    @Test
    fun adapterFoldsEmptySuccessIntoEmptySnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(emptyList(), fetchedAt = 5L, stale = false)))
            val result = httpStatusResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterKeepsLoadingCacheAsSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Loading(HttpStatusCatalog.codes, fetchedAt = 1L, stale = false)))
            val result = httpStatusResource(source).toList().last()
            assertTrue(result is Resource.Loading)
            assertEquals(19, result.cached?.codes?.size)
        }

    @Test
    fun adapterKeepsOfflineCacheAsSnapshotWithError() =
        runTest {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(
                            cached = HttpStatusCatalog.codes,
                            fetchedAt = 2L,
                            stale = true,
                            error = ApiError.Timeout(),
                        ),
                    ),
                )
            val result = httpStatusResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(19, result.cached?.codes?.size)
            assertTrue(result.stale)
        }

    @Test
    fun adapterPropagatesHardErrorWithoutCache() =
        runTest {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val result = httpStatusResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(null, result.cached)
        }

    @Test
    fun defaultSourceEmitsFullCatalogOnce() =
        runTest {
            val emissions = httpStatusToolSource().codes().toList()
            assertEquals(1, emissions.size)
            assertEquals(19, emissions.single().cached?.size)
        }

    // ── fakes ─────────────────────────────────────────────────────────────────────────

    private class FakeSource(
        private val emissions: List<Resource<List<HttpStatusCode>>>,
    ) : HttpStatusToolSource {
        override fun codes(): Flow<Resource<List<HttpStatusCode>>> = emissions.asFlow()

        override suspend fun refresh() = Unit
    }
}
