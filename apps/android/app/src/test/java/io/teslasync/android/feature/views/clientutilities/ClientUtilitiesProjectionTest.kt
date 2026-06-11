package io.teslasync.android.feature.views.clientutilities

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure (off-device) tests for the client-utilities search projection ([ClientUtilitiesProjection.filter] —
 * the web `filtered` memo) and the cache-then-network data adapter ([clientUtilitiesResource] /
 * [clientUtilitiesSource] — cached registry → snapshot projection), covering the registry, the case- and
 * whitespace-insensitive name/description match, the no-match branch, and the loading / success / error /
 * offline envelope folding.
 */
class ClientUtilitiesProjectionTest {
    // ── registry ──────────────────────────────────────────────────────────────────

    @Test
    fun catalogReproducesTheFifteenWebToolsInOrder() {
        val ids = ClientUtilitiesCatalog.tools.map { it.id }
        assertEquals(15, ids.size)
        assertEquals(ClientUtilityToolId.entries.toList(), ids)
        // The web ids are preserved verbatim so a host can wire each tool surface by slug.
        assertEquals("tesla-api", ClientUtilityToolId.TeslaApi.slug)
        assertEquals("unix-perm", ClientUtilityToolId.UnixPerm.slug)
    }

    @Test
    fun catalogBindsTheFourSharedCatalogKeysAndLeavesTheRestAsKeyFallback() {
        val base64 = tool(ClientUtilityToolId.Base64)
        val vin = tool(ClientUtilityToolId.Vin)
        // Base64 (name + desc) resolve through the shared catalog (P1/S10).
        assertTrue(base64.nameRes != null && base64.descRes != null)
        // Timestamp's name has a catalog entry; its description does not.
        assertTrue(tool(ClientUtilityToolId.Timestamp).nameRes != null)
        assertEquals(null, tool(ClientUtilityToolId.Timestamp).descRes)
        // Every other tool reproduces i18next's key-as-fallback (no catalog entry upstream).
        assertEquals(null, vin.nameRes)
        assertEquals("Vin Decoder", vin.nameKey)
    }

    // ── search projection (web `filtered`) ──────────────────────────────────────────

    @Test
    fun blankQueryReturnsEveryTool() {
        val all = sampleResolved()
        // The empty / blank-query fast path returns the same list instance (web `return tools`).
        assertSame(all, ClientUtilitiesProjection.filter(all, "").tools)
        assertSame(all, ClientUtilitiesProjection.filter(all, "   ").tools)
    }

    @Test
    fun queryMatchesOnNameCaseInsensitively() {
        val display = ClientUtilitiesProjection.filter(sampleResolved(), "DECODER")
        assertEquals(listOf(ClientUtilityToolId.Vin, ClientUtilityToolId.Jwt), display.tools.map { it.id })
        assertTrue(display.hasResults)
    }

    @Test
    fun queryMatchesOnDescription() {
        val display = ClientUtilitiesProjection.filter(sampleResolved(), "epoch")
        assertEquals(listOf(ClientUtilityToolId.Timestamp), display.tools.map { it.id })
    }

    @Test
    fun noMatchYieldsEmptyResults() {
        val display = ClientUtilitiesProjection.filter(sampleResolved(), "zzz-nothing")
        assertTrue(display.tools.isEmpty())
        assertFalse(display.hasResults)
    }

    // ── data adapter (cached → snapshot) ─────────────────────────────────────────────

    @Test
    fun adapterFoldsSuccessIntoSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(ClientUtilitiesCatalog.tools, fetchedAt = 5L, stale = false)))
            val result = clientUtilitiesResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(15, result.cached?.tools?.size)
            assertFalse(result.cached!!.isEmpty)
        }

    @Test
    fun adapterFoldsEmptySuccessIntoEmptySnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Success(emptyList(), fetchedAt = 5L, stale = false)))
            val result = clientUtilitiesResource(source).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached?.isEmpty == true)
        }

    @Test
    fun adapterKeepsLoadingCacheAsSnapshot() =
        runTest {
            val source = FakeSource(listOf(Resource.Loading(ClientUtilitiesCatalog.tools, fetchedAt = 1L, stale = false)))
            val result = clientUtilitiesResource(source).toList().last()
            assertTrue(result is Resource.Loading)
            assertEquals(15, result.cached?.tools?.size)
        }

    @Test
    fun adapterKeepsOfflineCacheAsSnapshotWithError() =
        runTest {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(
                            cached = ClientUtilitiesCatalog.tools,
                            fetchedAt = 2L,
                            stale = true,
                            error = ApiError.Timeout(),
                        ),
                    ),
                )
            val result = clientUtilitiesResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(15, result.cached?.tools?.size)
            assertTrue(result.stale)
        }

    @Test
    fun adapterPropagatesHardErrorWithoutCache() =
        runTest {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val result = clientUtilitiesResource(source).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(null, result.cached)
        }

    @Test
    fun defaultSourceEmitsFullCatalogOnce() =
        runTest {
            val emissions = clientUtilitiesSource().tools().toList()
            assertEquals(1, emissions.size)
            assertEquals(15, emissions.single().cached?.size)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private class FakeSource(
        private val emissions: List<Resource<List<ClientUtilityTool>>>,
    ) : ClientUtilitiesSource {
        override fun tools() = emissions.asFlow()

        override suspend fun refresh() = Unit
    }

    private fun tool(id: ClientUtilityToolId): ClientUtilityTool = ClientUtilitiesCatalog.tools.first { it.id == id }

    private fun resolved(
        id: ClientUtilityToolId,
        name: String,
        description: String,
    ): ResolvedClientUtility =
        ResolvedClientUtility(
            id = id,
            name = name,
            description = description,
            icon = ClientUtilitiesGlyphs.Hash,
            accent = ClientUtilityAccent.Cyan,
        )

    private fun sampleResolved(): List<ResolvedClientUtility> =
        listOf(
            resolved(ClientUtilityToolId.Vin, "Vin Decoder", "Decode a Tesla VIN"),
            resolved(ClientUtilityToolId.Jwt, "Jwt Decoder", "Inspect a JSON Web Token"),
            resolved(ClientUtilityToolId.Timestamp, "Timestamp", "Convert epoch to ISO"),
            resolved(ClientUtilityToolId.Hash, "Hash Calculator", "MD5, SHA-1, SHA-256"),
        )
}
