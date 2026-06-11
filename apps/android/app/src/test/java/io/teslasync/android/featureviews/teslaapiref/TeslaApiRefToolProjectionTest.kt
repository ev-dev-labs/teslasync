package io.teslasync.android.featureviews.teslaapiref

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure TeslaApiRefTool model + projection — the adapter test the prompt
 * requires (static reference + search query → render-ready rows). The web source binds no data feed (the
 * static TESLA_ENDPOINTS constant, filtered by `useMemo`), so the only surface states are the rendered
 * table and the search-yields-nothing empty result; these tests pin the search filter, the badge accent,
 * the pagination arithmetic, the projection, the i18n fallback contract, and the stable registration +
 * reference data (web parity).
 */
class TeslaApiRefToolProjectionTest {
    private val endpoints = TeslaApiReference.endpoints

    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationCarriesDiagnosticsSlugTableIdAndPageSize() {
        assertEquals("tesla-api-ref-tool", TeslaApiRefToolRegistration.ID)
        assertEquals("TeslaApiRefTool", TeslaApiRefToolRegistration.SLUG)
        // Web parity: tableId="admin:tesla-api-ref" and the DataTable default page size of 25.
        assertEquals("admin:tesla-api-ref", TeslaApiRefToolRegistration.TABLE_ID)
        assertEquals(25, TeslaApiRefToolRegistration.PAGE_SIZE)
    }

    // ---- reference data (web TESLA_ENDPOINTS parity) -----------------------------

    @Test
    fun referenceTableMirrorsWebConstantVerbatim() {
        assertEquals(11, endpoints.size)
        assertEquals(TeslaApiEndpoint("GET", "/api/1/vehicles", "List vehicles"), endpoints.first())
        assertEquals(
            TeslaApiEndpoint("GET", "/api/1/vehicles/{id}/nearby_charging_sites", "Nearby chargers"),
            endpoints.last(),
        )
        // The DataTable keys rows by path (web keyExtractor={(r) => r.path}), so paths must be unique.
        assertEquals(endpoints.size, endpoints.map { it.path }.toSet().size)
    }

    @Test
    fun referenceTableHasThreeGetEndpointsAndEightPostEndpoints() {
        assertEquals(3, endpoints.count { it.method == "GET" })
        assertEquals(8, endpoints.count { it.method == "POST" })
    }

    // ---- badge accent (web 'info' / 'warning') -----------------------------------

    @Test
    fun accentForMethodMirrorsWebTernary() {
        // Web: r.method === 'GET' ? 'info' : 'warning'.
        assertEquals(MethodAccent.Info, accentForMethod("GET"))
        assertEquals(MethodAccent.Warning, accentForMethod("POST"))
        assertEquals(MethodAccent.Warning, accentForMethod("DELETE"))
        assertEquals(MethodAccent.Warning, accentForMethod(""))
    }

    // ---- search filter (web useMemo) ---------------------------------------------

    @Test
    fun blankOrWhitespaceQueryReturnsEveryEndpoint() {
        assertEquals(11, filterEndpoints(endpoints, "").size)
        assertEquals(11, filterEndpoints(endpoints, "   ").size)
    }

    @Test
    fun queryMatchesAcrossMethodPathAndDescription() {
        // Every path contains "vehicles".
        assertEquals(11, filterEndpoints(endpoints, "vehicles").size)
        // "wake" matches one row (path command/wake_up + desc "Wake up vehicle").
        val wake = filterEndpoints(endpoints, "wake")
        assertEquals(1, wake.size)
        assertEquals("/api/1/vehicles/{id}/command/wake_up", wake.single().path)
        // "doors" matches the lock + unlock descriptions ("Lock doors" / "Unlock doors").
        assertEquals(2, filterEndpoints(endpoints, "doors").size)
    }

    @Test
    fun methodQueryFiltersByVerbCaseInsensitively() {
        val get = filterEndpoints(endpoints, "GET")
        assertEquals(3, get.size)
        assertTrue(get.all { it.method == "GET" })
        // Case-insensitive: lower- and upper-case queries are equivalent (web toLowerCase()).
        assertEquals(get, filterEndpoints(endpoints, "get"))
        val post = filterEndpoints(endpoints, "post")
        assertEquals(8, post.size)
        assertTrue(post.all { it.method == "POST" })
    }

    @Test
    fun unmatchedQueryReturnsEmpty() {
        assertTrue(filterEndpoints(endpoints, "zzz-no-such-endpoint").isEmpty())
    }

    // ---- pagination arithmetic (web data.slice) ----------------------------------

    @Test
    fun pageCountIsAtLeastOneAndRoundsUp() {
        assertEquals(1, TeslaApiRefPaging.pageCount(0, 25))
        assertEquals(1, TeslaApiRefPaging.pageCount(11, 25))
        assertEquals(1, TeslaApiRefPaging.pageCount(25, 25))
        assertEquals(2, TeslaApiRefPaging.pageCount(26, 25))
        assertEquals(2, TeslaApiRefPaging.pageCount(50, 25))
        assertEquals(3, TeslaApiRefPaging.pageCount(51, 25))
    }

    @Test
    fun pageSlicesAndClampsOutOfRangePages() {
        val list = (1..30).toList()
        assertEquals((1..25).toList(), TeslaApiRefPaging.page(list, 1, 25))
        assertEquals((26..30).toList(), TeslaApiRefPaging.page(list, 2, 25))
        // Out-of-range page numbers clamp into range rather than throwing.
        assertEquals((26..30).toList(), TeslaApiRefPaging.page(list, 9, 25))
        assertEquals((1..25).toList(), TeslaApiRefPaging.page(list, 0, 25))
        assertTrue(TeslaApiRefPaging.page(emptyList<Int>(), 1, 25).isEmpty())
    }

    @Test
    fun allElevenEndpointsFitOnTheFirstPage() {
        // With 11 rows and a page size of 25, the single page holds every endpoint (web parity).
        assertEquals(11, TeslaApiRefPaging.page(endpoints, 1, TeslaApiRefToolRegistration.PAGE_SIZE).size)
    }

    // ---- projection (content state) ----------------------------------------------

    @Test
    fun projectionKeepsWebOrderAndDerivesAccentAndCopyLabel() {
        val rows = TeslaApiRefProjection.rows(endpoints, "", "Copy")
        assertEquals(11, rows.size)
        assertEquals(endpoints, rows.map { it.endpoint })
        assertEquals(endpoints.map { accentForMethod(it.method) }, rows.map { it.accent })
        // Per-row copy label folds the localized verb with the path for a distinct TalkBack name.
        assertEquals("Copy /api/1/vehicles", rows.first().copyActionLabel)
        rows.forEach { assertEquals("Copy ${it.endpoint.path}", it.copyActionLabel) }
    }

    @Test
    fun projectionAppliesTheSearchFilter() {
        val wake = TeslaApiRefProjection.rows(endpoints, "wake", "Copy")
        assertEquals(1, wake.size)
        assertEquals(MethodAccent.Warning, wake.single().accent)
        assertEquals("Copy /api/1/vehicles/{id}/command/wake_up", wake.single().copyActionLabel)
        // Empty (no-match) projection — the surface's empty state.
        assertTrue(TeslaApiRefProjection.rows(endpoints, "zzz", "Copy").isEmpty())
    }

    // ---- i18n fallback (web t(key, default)) -------------------------------------

    @Test
    fun resolveOptionalPrefersCatalogValueWhenPresentElseFallsBack() {
        assertEquals("Localized", resolveOptional({ "Localized" }, TeslaApiRefKeys.TITLE, "Tesla Api Ref"))
        // Absent key (today's catalog) → the documented fallback renders, matching what the web shows.
        assertEquals("Tesla Api Ref", resolveOptional({ null }, TeslaApiRefKeys.TITLE, "Tesla Api Ref"))
        // A blank catalog value is treated as absent so the surface never shows an empty string.
        assertEquals("Search Endpoints", resolveOptional({ "  " }, TeslaApiRefKeys.SEARCH_HINT, "Search Endpoints"))
    }

    @Test
    fun absentCatalogKeysAndDefaultsMatchWebParity() {
        // The four keys absent from the catalog fold spaces to underscores under the translation_ prefix.
        assertEquals("translation_Tesla_Api_Ref", TeslaApiRefKeys.TITLE)
        assertEquals("translation_Tesla_Api_Ref_Desc", TeslaApiRefKeys.DESCRIPTION)
        assertEquals("translation_Search_Endpoints", TeslaApiRefKeys.SEARCH_HINT)
        assertEquals("translation_Endpoint_Desc", TeslaApiRefKeys.DESC_HEADER)
        // The documented fallbacks equal the exact text the web renders today (the natural-language key).
        assertEquals("Tesla Api Ref", TeslaApiRefDefaults.TITLE)
        assertEquals("Tesla Api Ref Desc", TeslaApiRefDefaults.DESCRIPTION)
        assertEquals("Search Endpoints", TeslaApiRefDefaults.SEARCH_HINT)
        assertEquals("Endpoint Desc", TeslaApiRefDefaults.DESC_HEADER)
    }

    @Test
    fun resolvedTitlesAreNeverBlankWhenTheCatalogIsAbsent() {
        val absent: (String) -> String? = { null }
        val title = resolveOptional(absent, TeslaApiRefKeys.TITLE, TeslaApiRefDefaults.TITLE)
        val desc = resolveOptional(absent, TeslaApiRefKeys.DESCRIPTION, TeslaApiRefDefaults.DESCRIPTION)
        assertTrue(title.isNotBlank())
        assertTrue(desc.isNotBlank())
        assertNull(listOf(title, desc).firstOrNull { it.isBlank() })
    }
}
