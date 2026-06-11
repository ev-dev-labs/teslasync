package io.teslasync.android.featureviews.referencelinks

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure Reference Links model + projection — the adapter test the prompt
 * requires (localized strings → render-ready cards). The web source is purely presentational (static
 * REFERENCE_LINKS, no data feed), so the only surface state is the rendered grid; these tests pin that
 * single state's projection plus the i18n fallback contract, the stable link targets/URLs/glyphs, the
 * responsive column policy, the folded TalkBack content descriptions, and the documented title fallbacks.
 */
class ReferenceLinksProjectionTest {
    private val strings =
        ReferenceLinkStrings(
            fleetOverviewTitle = "Fleet API Overview",
            partnerEndpointsTitle = "Partner Endpoints",
            devPortalTitle = "Developer Portal",
            telemetryGuideTitle = "Fleet Telemetry Guide",
            emptyMessage = "No data available",
        )

    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationCarriesDiagnosticsSlugAndColumnPolicy() {
        assertEquals("ReferenceLinksSection", ReferenceLinksRegistration.SLUG)
        assertEquals(1, ReferenceLinksRegistration.COMPACT_COLUMNS)
        assertEquals(2, ReferenceLinksRegistration.MEDIUM_COLUMNS)
        assertEquals(4, ReferenceLinksRegistration.EXPANDED_COLUMNS)
    }

    @Test
    fun columnCountMirrorsResponsiveGrid() {
        // Web `grid` (base 1) `sm:grid-cols-2` `lg:grid-cols-4`.
        assertEquals(1, ReferenceLinksProjection.columnCount(ReferenceLinksWidth.Compact))
        assertEquals(2, ReferenceLinksProjection.columnCount(ReferenceLinksWidth.Medium))
        assertEquals(4, ReferenceLinksProjection.columnCount(ReferenceLinksWidth.Expanded))
    }

    // ---- link targets ------------------------------------------------------------

    @Test
    fun targetsCarryUrlGlyphAndKeysInWebOrder() {
        assertEquals(
            listOf(
                "https://developer.tesla.com/docs/fleet-api",
                "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register",
                "https://developer.tesla.com",
                "https://developer.tesla.com/docs/fleet-api/fleet-telemetry",
            ),
            ReferenceLinkTarget.entries.map { it.url },
        )
        assertEquals(
            listOf(
                ReferenceLinkGlyph.BookOpen,
                ReferenceLinkGlyph.Globe,
                ReferenceLinkGlyph.ExternalLink,
                ReferenceLinkGlyph.Radio,
            ),
            ReferenceLinkTarget.entries.map { it.glyph },
        )
        assertEquals(
            listOf(
                "devtools.ref.fleetOverview",
                "devtools.ref.partnerEndpoints",
                "devtools.ref.devPortal",
                "devtools.ref.telemetryGuide",
            ),
            ReferenceLinkTarget.entries.map { it.webI18nKey },
        )
    }

    @Test
    fun androidResourceNamesFoldTheCatalogKey() {
        // The generated catalog names a key by prefixing `translation.` and folding dots to underscores.
        assertEquals(
            listOf(
                "translation_devtools_ref_fleetOverview",
                "translation_devtools_ref_partnerEndpoints",
                "translation_devtools_ref_devPortal",
                "translation_devtools_ref_telemetryGuide",
            ),
            ReferenceLinkTarget.entries.map { it.androidResourceName },
        )
    }

    // ---- i18n fallback (web t(key, default)) -------------------------------------

    @Test
    fun resolveOptionalPrefersCatalogValueWhenPresent() {
        val value = resolveOptional({ "Localized" }, "translation_devtools_ref_fleetOverview", "Fleet API Overview")
        assertEquals("Localized", value)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        // Absent key (today's catalog): the documented fallback renders, just as web t(key, default) does.
        assertEquals(
            "Fleet API Overview",
            resolveOptional({ null }, "translation_devtools_ref_fleetOverview", "Fleet API Overview"),
        )
        // A blank catalog value is treated as absent so the surface never shows an empty title.
        assertEquals(
            "Developer Portal",
            resolveOptional({ "  " }, "translation_devtools_ref_devPortal", "Developer Portal"),
        )
    }

    @Test
    fun titleDefaultsAreDocumentedAndNonBlank() {
        assertEquals("Fleet API Overview", ReferenceLinkDefaults.FLEET_OVERVIEW_TITLE)
        assertEquals("Partner Endpoints", ReferenceLinkDefaults.PARTNER_ENDPOINTS_TITLE)
        assertEquals("Developer Portal", ReferenceLinkDefaults.DEV_PORTAL_TITLE)
        assertEquals("Fleet Telemetry Guide", ReferenceLinkDefaults.TELEMETRY_GUIDE_TITLE)
    }

    // ---- content-state projection ------------------------------------------------

    @Test
    fun contentStateAlwaysRendersFourLinksInWebOrder() {
        val items = ReferenceLinksProjection.items(strings)
        assertEquals(4, items.size)
        assertEquals(
            listOf(
                ReferenceLinkTarget.FLEET_OVERVIEW,
                ReferenceLinkTarget.PARTNER_ENDPOINTS,
                ReferenceLinkTarget.DEV_PORTAL,
                ReferenceLinkTarget.TELEMETRY_GUIDE,
            ),
            items.map { it.target },
        )
        assertEquals(
            listOf("Fleet API Overview", "Partner Endpoints", "Developer Portal", "Fleet Telemetry Guide"),
            items.map { it.title },
        )
        assertEquals(ReferenceLinkTarget.entries.map { it.url }, items.map { it.url })
    }

    @Test
    fun eachCardCarriesItsTargetGlyph() {
        val glyphs = ReferenceLinksProjection.items(strings).associate { it.target to it.glyph }
        assertEquals(ReferenceLinkGlyph.BookOpen, glyphs.getValue(ReferenceLinkTarget.FLEET_OVERVIEW))
        assertEquals(ReferenceLinkGlyph.Globe, glyphs.getValue(ReferenceLinkTarget.PARTNER_ENDPOINTS))
        assertEquals(ReferenceLinkGlyph.ExternalLink, glyphs.getValue(ReferenceLinkTarget.DEV_PORTAL))
        assertEquals(ReferenceLinkGlyph.Radio, glyphs.getValue(ReferenceLinkTarget.TELEMETRY_GUIDE))
    }

    // ---- accessibility -----------------------------------------------------------

    @Test
    fun eachCardExposesAFoldedContentDescription() {
        val items = ReferenceLinksProjection.items(strings)
        // Every card reads as a single TalkBack node: "<title>, <url>" — never blank.
        items.forEach { item ->
            assertTrue(item.contentDescription.isNotBlank())
            assertEquals("${item.title}, ${item.url}", item.contentDescription)
        }
        assertEquals(
            "Fleet API Overview, https://developer.tesla.com/docs/fleet-api",
            items.first().contentDescription,
        )
        assertEquals(
            "Fleet Telemetry Guide, https://developer.tesla.com/docs/fleet-api/fleet-telemetry",
            items.last().contentDescription,
        )
    }

    @Test
    fun blankLookupNeverLeavesATitleEmpty() {
        // Every title key is absent in today's catalog → all fall back to the documented defaults, none blank.
        val absent: (String) -> String? = { null }
        val resolvedTitles =
            ReferenceLinkTarget.entries.map { target ->
                resolveOptional(absent, target.androidResourceName, defaultTitleFor(target))
            }
        assertNull(resolvedTitles.firstOrNull { it.isBlank() })
        assertEquals(
            listOf("Fleet API Overview", "Partner Endpoints", "Developer Portal", "Fleet Telemetry Guide"),
            resolvedTitles,
        )
    }

    private fun defaultTitleFor(target: ReferenceLinkTarget): String =
        when (target) {
            ReferenceLinkTarget.FLEET_OVERVIEW -> ReferenceLinkDefaults.FLEET_OVERVIEW_TITLE
            ReferenceLinkTarget.PARTNER_ENDPOINTS -> ReferenceLinkDefaults.PARTNER_ENDPOINTS_TITLE
            ReferenceLinkTarget.DEV_PORTAL -> ReferenceLinkDefaults.DEV_PORTAL_TITLE
            ReferenceLinkTarget.TELEMETRY_GUIDE -> ReferenceLinkDefaults.TELEMETRY_GUIDE_TITLE
        }
}
