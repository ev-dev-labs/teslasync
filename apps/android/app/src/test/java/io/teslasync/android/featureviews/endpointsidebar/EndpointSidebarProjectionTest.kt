package io.teslasync.android.featureviews.endpointsidebar

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure (off-device) tests for the EndpointSidebar model: the verb / location wire mapping, the endpoint
 * identity key, the search projection ([EndpointSidebarProjection.filter] — the web `filtered` memo over
 * path / summary / operationId), the group-by-tag fold ([EndpointSidebarProjection.group] — the web
 * `grouped` memo), the per-group `defaultOpen` rule, and the cache-then-network data adapter
 * ([endpointSidebarResource] / [endpointSidebarSource] — cached list → snapshot projection), covering the
 * loading / success / empty / error / offline envelope folding.
 */
class EndpointSidebarProjectionTest {
    // ── wire enums + identity ─────────────────────────────────────────────────────────

    @Test
    fun methodFromWireIsCaseInsensitiveAndRejectsUnknown() {
        assertEquals(HttpMethod.Get, HttpMethod.fromWire("get"))
        assertEquals(HttpMethod.Post, HttpMethod.fromWire("POST"))
        assertEquals(HttpMethod.Patch, HttpMethod.fromWire(" patch "))
        assertNull(HttpMethod.fromWire("bogus"))
    }

    @Test
    fun paramLocationFromWireDefaultsToQuery() {
        assertEquals(ParamLocation.Path, ParamLocation.fromWire("path"))
        assertEquals(ParamLocation.Query, ParamLocation.fromWire("query"))
        // The web `?? 'query'` fallback for a missing / unknown `in`.
        assertEquals(ParamLocation.Query, ParamLocation.fromWire(null))
        assertEquals(ParamLocation.Query, ParamLocation.fromWire("header"))
    }

    @Test
    fun identityComposesVerbAndPath() {
        assertEquals("GET /vehicles", endpoint(HttpMethod.Get, "/vehicles").identity)
        assertEquals("POST /vehicles", endpoint(HttpMethod.Post, "/vehicles").identity)
    }

    // ── search projection (web `filtered`) ────────────────────────────────────────────

    @Test
    fun blankQueryReturnsTheListUnchanged() {
        val all = sampleEndpoints()
        // The blank-query fast path returns the same list instance (web `return endpoints`).
        assertSame(all, EndpointSidebarProjection.filter(all, ""))
        assertSame(all, EndpointSidebarProjection.filter(all, "   "))
    }

    @Test
    fun queryMatchesOnPathCaseInsensitively() {
        val out = EndpointSidebarProjection.filter(sampleEndpoints(), "CHARGING")
        assertEquals(listOf("/charging"), out.map { it.path })
    }

    @Test
    fun queryMatchesOnSummary() {
        val out = EndpointSidebarProjection.filter(sampleEndpoints(), "send command")
        assertEquals(listOf("/vehicles/{vehicleID}/command"), out.map { it.path })
    }

    @Test
    fun queryMatchesOnOperationId() {
        val out = EndpointSidebarProjection.filter(sampleEndpoints(), "deleterule")
        assertEquals(listOf("/alerts/rules/{ruleID}"), out.map { it.path })
    }

    @Test
    fun noMatchYieldsEmptyList() {
        assertTrue(EndpointSidebarProjection.filter(sampleEndpoints(), "zzz-nothing").isEmpty())
    }

    // ── group projection (web `grouped`) ───────────────────────────────────────────────

    @Test
    fun groupingPreservesFirstEncounterOrder() {
        val groups = EndpointSidebarProjection.group(sampleEndpoints())
        assertEquals(listOf("Vehicles", "Charging", "Alerts"), groups.map { it.tag })
        assertEquals(3, groups.first().count)
    }

    @Test
    fun blankTagFallsBackToOther() {
        val groups = EndpointSidebarProjection.group(listOf(endpoint(HttpMethod.Get, "/ping", tag = "")))
        assertEquals(listOf(EndpointSidebarProjection.OTHER_TAG), groups.map { it.tag })
    }

    @Test
    fun displayReportsMatchCountAndGroups() {
        val display = EndpointSidebarProjection.display(sampleEndpoints(), "")
        assertEquals(5, display.matchCount)
        assertEquals(3, display.groupCount)
        assertTrue(display.hasResults)
    }

    @Test
    fun displayWithNoMatchesHasNoResults() {
        val display = EndpointSidebarProjection.display(sampleEndpoints(), "zzz-nothing")
        assertEquals(0, display.matchCount)
        assertTrue(display.groups.isEmpty())
        assertFalse(display.hasResults)
    }

    // ── defaultOpen rule (web `selected?.tag === tag || grouped.size <= 5`) ──────────────

    @Test
    fun defaultOpenWhenFewGroups() {
        assertTrue(EndpointSidebarProjection.isDefaultOpen("Vehicles", selected = null, groupCount = 5))
    }

    @Test
    fun defaultOpenWhenGroupHoldsSelection() {
        val selected = endpoint(HttpMethod.Get, "/vehicles", tag = "Vehicles")
        assertTrue(EndpointSidebarProjection.isDefaultOpen("Vehicles", selected = selected, groupCount = 9))
    }

    @Test
    fun defaultClosedWhenManyGroupsAndNotSelected() {
        val selected = endpoint(HttpMethod.Get, "/vehicles", tag = "Vehicles")
        assertFalse(EndpointSidebarProjection.isDefaultOpen("Charging", selected = selected, groupCount = 9))
        assertFalse(EndpointSidebarProjection.isDefaultOpen("Charging", selected = null, groupCount = 9))
    }

    // ── data adapter (cached → snapshot) ───────────────────────────────────────────────

    @Test
    fun adapterFoldsSuccessIntoSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(sampleEndpoints(), fetchedAt = 5L, stale = false)))
            val result = endpointSidebarResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(5, result.cached?.endpoints?.size)
            assertFalse(result.cached!!.isEmpty)
        }

    @Test
    fun adapterFoldsEmptySuccessIntoEmptySnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(emptyList(), fetchedAt = 5L, stale = false)))
            val result = endpointSidebarResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterKeepsLoadingCacheAsSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Loading(sampleEndpoints(), fetchedAt = 1L, stale = false)))
            val result = endpointSidebarResource(source).toList().last()
            assertTrue(result is Resource.Loading)
            assertEquals(5, result.cached?.endpoints?.size)
        }

    @Test
    fun adapterKeepsOfflineCacheAsSnapshotWithError() =
        runTest {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(
                            cached = sampleEndpoints(),
                            fetchedAt = 2L,
                            stale = true,
                            error = ApiError.Timeout(),
                        ),
                    ),
                )
            val result = endpointSidebarResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(5, result.cached?.endpoints?.size)
            assertTrue(result.stale)
        }

    @Test
    fun adapterPropagatesHardErrorWithoutCache() =
        runTest {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val result = endpointSidebarResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertNull(result.cached)
        }

    @Test
    fun defaultSourceEmitsProvidedListOnce() =
        runTest {
            val emissions = endpointSidebarSource(sampleEndpoints()).endpoints().toList()
            assertEquals(1, emissions.size)
            assertEquals(5, emissions.single().cached?.size)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────

    private fun endpoint(
        method: HttpMethod,
        path: String,
        tag: String = "Misc",
        summary: String = "",
        operationId: String = "",
    ): ParsedEndpoint = ParsedEndpoint(method, path, tag, summary, operationId = operationId)

    private fun sampleEndpoints(): List<ParsedEndpoint> =
        listOf(
            endpoint(HttpMethod.Get, "/vehicles", "Vehicles", "List vehicles", "listVehicles"),
            endpoint(HttpMethod.Get, "/vehicles/{vehicleID}/state", "Vehicles", "Vehicle state", "vehicleState"),
            endpoint(HttpMethod.Post, "/vehicles/{vehicleID}/command", "Vehicles", "Send command", "sendCommand"),
            endpoint(HttpMethod.Get, "/charging", "Charging", "List charging sessions", "listCharging"),
            endpoint(HttpMethod.Delete, "/alerts/rules/{ruleID}", "Alerts", "Delete rule", "deleteRule"),
        )

    private class FakeSource(
        private val emissions: List<Resource<List<ParsedEndpoint>>>,
    ) : EndpointSidebarSource {
        override fun endpoints(): Flow<Resource<List<ParsedEndpoint>>> = emissions.asFlow()

        override suspend fun refresh() = Unit
    }
}
