package io.teslasync.android.dashboard.widgets.quicknav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure Quick Navigation model + projection — the adapter test the prompt
 * requires (localized strings → render-ready shortcut cards). QuickNav is purely presentational (no data
 * feed, no unit-bearing values), so the only surface state is the rendered grid; these tests pin that
 * single state's projection plus the i18n fallback contract, the stable nav targets, the per-item accent
 * palette, the folded TalkBack content descriptions, and the registry footprint.
 */
class QuickNavProjectionTest {
    private val strings =
        QuickNavStrings(
            drives = "Drives",
            drivesDesc = "Trip history",
            charging = "Charging",
            chargingDesc = "Sessions & costs",
            analytics = "Analytics",
            analyticsDesc = "Fleet insights",
            battery = "Battery Health",
            batteryDesc = "Health & degradation",
        )

    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("quick-nav", QuickNavRegistration.ID)
        assertEquals("system", QuickNavRegistration.CATEGORY)
        assertEquals("QuickNavWidget", QuickNavRegistration.SLUG)
        assertEquals(QuickNavSize(4, 2), QuickNavRegistration.defaultSize)
        assertEquals(QuickNavSize(2, 2), QuickNavRegistration.minSize)
        assertEquals(QuickNavSize(4, 40), QuickNavRegistration.maxSize)
    }

    @Test
    fun registrationClampsToBounds() {
        assertEquals(QuickNavSize(2, 2), QuickNavRegistration.clamp(QuickNavSize(1, 1)))
        assertEquals(QuickNavSize(4, 40), QuickNavRegistration.clamp(QuickNavSize(9, 99)))
        assertTrue(QuickNavRegistration.isWithinBounds(QuickNavSize(4, 2)))
        assertFalse(QuickNavRegistration.isWithinBounds(QuickNavSize(1, 1)))
    }

    @Test
    fun columnCountMirrorsResponsiveGrid() {
        // Web `grid-cols-2 sm:grid-cols-4`: a wide footprint lays the cards four-up, a narrow one two-up.
        assertEquals(4, QuickNavRegistration.columnCount(QuickNavRegistration.defaultSize))
        assertEquals(4, QuickNavRegistration.columnCount(QuickNavSize(3, 2)))
        assertEquals(2, QuickNavRegistration.columnCount(QuickNavRegistration.minSize))
        assertEquals(2, QuickNavRegistration.columnCount(QuickNavSize(2, 8)))
    }

    // ---- nav targets -------------------------------------------------------------

    @Test
    fun destinationsCarryNativeIdAndWebPathInOrder() {
        assertEquals(
            listOf("drives", "charging", "analytics", "batteryHealth"),
            QuickNavDestination.entries.map { it.destinationId },
        )
        assertEquals(
            listOf("/drives", "/charging", "/analytics", "/battery"),
            QuickNavDestination.entries.map { it.webPath },
        )
    }

    // ---- i18n fallback (web t(key, default)) -------------------------------------

    @Test
    fun resolveOptionalPrefersCatalogValueWhenPresent() {
        val value = resolveOptional({ "Localized" }, "translation_nav_drivesDesc", "Trip history")
        assertEquals("Localized", value)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        // Absent key (today's catalog): the web source's inline default renders, exactly as web t() does.
        assertEquals("Trip history", resolveOptional({ null }, "translation_nav_drivesDesc", "Trip history"))
        // A blank catalog value is treated as absent so the surface never shows an empty description.
        assertEquals("Fleet insights", resolveOptional({ "   " }, "translation_nav_analyticsDesc", "Fleet insights"))
    }

    @Test
    fun descriptionDefaultsMatchWebSource() {
        assertEquals("Trip history", QuickNavDefaults.DRIVES_DESC)
        assertEquals("Sessions & costs", QuickNavDefaults.CHARGING_DESC)
        assertEquals("Fleet insights", QuickNavDefaults.ANALYTICS_DESC)
        assertEquals("Health & degradation", QuickNavDefaults.BATTERY_DESC)
    }

    // ---- content-state projection ------------------------------------------------

    @Test
    fun contentStateAlwaysRendersFourShortcutsInWebOrder() {
        val items = QuickNavProjection.items(strings)
        assertEquals(4, items.size)
        assertEquals(
            listOf(
                QuickNavDestination.DRIVES,
                QuickNavDestination.CHARGING,
                QuickNavDestination.ANALYTICS,
                QuickNavDestination.BATTERY,
            ),
            items.map { it.destination },
        )
        assertEquals(
            listOf("Drives", "Charging", "Analytics", "Battery Health"),
            items.map { it.label },
        )
        assertEquals(
            listOf("Trip history", "Sessions & costs", "Fleet insights", "Health & degradation"),
            items.map { it.description },
        )
    }

    @Test
    fun eachCardCarriesItsExactWebAccentHex() {
        val accents = QuickNavProjection.items(strings).associate { it.destination to it.accentArgb }
        assertEquals(0xFF00F0FFL, accents.getValue(QuickNavDestination.DRIVES))
        assertEquals(0xFF10B981L, accents.getValue(QuickNavDestination.CHARGING))
        assertEquals(0xFFA855F7L, accents.getValue(QuickNavDestination.ANALYTICS))
        assertEquals(0xFFF59E0BL, accents.getValue(QuickNavDestination.BATTERY))
    }

    // ---- accessibility -----------------------------------------------------------

    @Test
    fun eachCardExposesAFoldedContentDescription() {
        val items = QuickNavProjection.items(strings)
        // Every card reads as a single TalkBack node: "<label>, <description>" — never blank.
        items.forEach { item ->
            assertTrue(item.contentDescription.isNotBlank())
            assertEquals("${item.label}, ${item.description}", item.contentDescription)
        }
        assertEquals("Drives, Trip history", items.first().contentDescription)
        assertEquals("Battery Health, Health & degradation", items.last().contentDescription)
    }

    @Test
    fun blankLookupNeverLeavesADescriptionEmpty() {
        // Drives label key resolves; every description key is absent → all fall back, none blank.
        val resolved =
            QuickNavStrings(
                drives = "Drives",
                drivesDesc = resolveOptional({ null }, "translation_nav_drivesDesc", QuickNavDefaults.DRIVES_DESC),
                charging = "Charging",
                chargingDesc = resolveOptional({ null }, "translation_nav_chargingDesc", QuickNavDefaults.CHARGING_DESC),
                analytics = "Analytics",
                analyticsDesc = resolveOptional({ null }, "translation_nav_analyticsDesc", QuickNavDefaults.ANALYTICS_DESC),
                battery = "Battery Health",
                batteryDesc = resolveOptional({ null }, "translation_nav_batteryDesc", QuickNavDefaults.BATTERY_DESC),
            )
        assertNull(QuickNavProjection.items(resolved).firstOrNull { it.description.isBlank() })
    }
}
