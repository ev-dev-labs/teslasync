package io.teslasync.android.dashboard.widgets.energysiteinfo

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the EnergySiteInfoWidget's pure logic — the raw-SI-JSON decode of both feeds
 * (catalog id resolution + the `data`-wrapped site-info), the watts→kW / watt-hours→kWh scaling, the four
 * detail-row projection (incl. the firmware mono flag + the em-dash null handling), the two empty-message
 * branches (no linked site vs. linked-but-no-detail), the folded TalkBack content description, and the
 * registry metadata. Mirrors the web spec (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx).
 */
class EnergySiteInfoProjectionTest {
    private val strings =
        EnergySiteInfoStrings(
            title = "Energy Site",
            solarSize = "Solar System",
            powerwall = "Powerwalls",
            firmware = "Gateway Firmware",
            timezone = "Installation Timezone",
            noSite = "No Tesla Energy site linked",
            noData = "No site info available",
        )

    private fun project(state: EnergySiteInfoState): EnergySiteInfoDisplay = EnergySiteInfoProjection.project(state, strings, Locale.US)

    private fun siteInfo(
        powerW: Double? = null,
        energyWh: Double? = null,
        count: Int? = null,
        version: String? = null,
        timeZone: String? = null,
    ) = EnergySiteInfo(powerW, energyWh, count, version, timeZone)

    @Test
    fun parseHasSiteReflectsArrayPresence() {
        assertTrue(parseHasSite(buildJsonArray { add(buildJsonObject { put("energy_site_id", 5L) }) }))
        assertFalse(parseHasSite(buildJsonArray {}))
        assertFalse(parseHasSite(null))
        assertFalse(parseHasSite(buildJsonObject { put("energy_site_id", 5L) }))
    }

    @Test
    fun parseFirstSiteIdReadsLeadingEntry() {
        val sites =
            buildJsonArray {
                add(buildJsonObject { put("energy_site_id", 42L) })
                add(buildJsonObject { put("energy_site_id", 99L) })
            }
        assertEquals(42L, parseFirstSiteId(sites))
    }

    @Test
    fun parseFirstSiteIdAcceptsStringEncodedId() {
        val sites = buildJsonArray { add(buildJsonObject { put("energy_site_id", "7") }) }
        assertEquals(7L, parseFirstSiteId(sites))
    }

    @Test
    fun parseFirstSiteIdIsNullWhenAbsentEmptyOrIdless() {
        assertNull(parseFirstSiteId(null))
        assertNull(parseFirstSiteId(buildJsonArray {}))
        assertNull(parseFirstSiteId(buildJsonArray { add(buildJsonObject { put("resource_type", "battery") }) }))
        assertNull(parseFirstSiteId(JsonPrimitive("nope")))
    }

    @Test
    fun parseSiteInfoReadsSnakeCaseSiFields() {
        val json =
            buildJsonObject {
                put(
                    "data",
                    buildJsonObject {
                        put("nameplate_power", 10500.0)
                        put("nameplate_energy", 13500.0)
                        put("battery_count", 2)
                        put("version", "23.44.0")
                        put("installation_time_zone", "America/Los_Angeles")
                    },
                )
            }
        assertEquals(siteInfo(10500.0, 13500.0, 2, "23.44.0", "America/Los_Angeles"), parseSiteInfo(json))
    }

    @Test
    fun parseSiteInfoIsNullWhenDataAbsentOrNull() {
        assertNull(parseSiteInfo(buildJsonObject {}))
        assertNull(parseSiteInfo(buildJsonObject { put("data", JsonNull) }))
        assertNull(parseSiteInfo(JsonPrimitive("x")))
        assertNull(parseSiteInfo(null))
    }

    @Test
    fun parseSiteInfoKeepsPresentEmptyObjectWithNullFields() {
        val json = buildJsonObject { put("data", buildJsonObject {}) }
        assertEquals(siteInfo(), parseSiteInfo(json))
    }

    @Test
    fun projectBuildsFourRowsInWebOrder() {
        val display = project(EnergySiteInfoState(hasSites = true, info = siteInfo(10500.0, 13500.0, 2, "23.44.0", "America/Los_Angeles")))
        assertEquals(4, display.entries.size)
        assertEquals(EnergySiteEntry("Solar System", "10.5 kW", false), display.entries[0])
        assertEquals(EnergySiteEntry("Powerwalls", "2 \u00d7 13.5 kWh", false), display.entries[1])
        assertEquals(EnergySiteEntry("Gateway Firmware", "23.44.0", true), display.entries[2])
        assertEquals(EnergySiteEntry("Installation Timezone", "America/Los_Angeles", false), display.entries[3])
        assertEquals(
            "Solar System 10.5 kW, Powerwalls 2 \u00d7 13.5 kWh, Gateway Firmware 23.44.0, Installation Timezone America/Los_Angeles",
            display.contentDescription,
        )
    }

    @Test
    fun projectEmDashesEachAbsentFieldButKeepsRows() {
        val display = project(EnergySiteInfoState(hasSites = true, info = siteInfo()))
        assertEquals(4, display.entries.size)
        assertEquals("\u2014", display.entries[0].value)
        assertEquals("\u2014", display.entries[1].value)
        assertNull(display.entries[2].value)
        assertNull(display.entries[3].value)
        assertTrue(display.entries[2].mono)
    }

    @Test
    fun powerwallValueShowsCountTimesEnergy() {
        assertEquals("2 \u00d7 13.5 kWh", EnergySiteInfoProjection.powerwallValue(siteInfo(energyWh = 13500.0, count = 2), Locale.US))
        assertEquals("\u2014", EnergySiteInfoProjection.powerwallValue(siteInfo(count = 0), Locale.US))
        assertEquals("3 \u00d7 \u2014 kWh", EnergySiteInfoProjection.powerwallValue(siteInfo(count = 3), Locale.US))
    }

    @Test
    fun solarValueScalesWattsToKilowatts() {
        assertEquals("10.5 kW", EnergySiteInfoProjection.solarValue(siteInfo(powerW = 10500.0), Locale.US))
        assertEquals("\u2014", EnergySiteInfoProjection.solarValue(siteInfo(), Locale.US))
    }

    @Test
    fun projectNoLinkedSiteShowsNoSiteMessage() {
        val display = project(EnergySiteInfoState.NO_SITES)
        assertTrue(display.entries.isEmpty())
        assertEquals("No Tesla Energy site linked", display.emptyMessage)
        assertEquals("No Tesla Energy site linked", display.contentDescription)
    }

    @Test
    fun projectLinkedSiteWithoutDetailShowsNoDataMessage() {
        val display = project(EnergySiteInfoState(hasSites = true, info = null))
        assertTrue(display.entries.isEmpty())
        assertEquals("No site info available", display.emptyMessage)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("energy-site-info", EnergySiteInfoRegistration.ID)
        assertEquals("energy", EnergySiteInfoRegistration.CATEGORY)
        assertEquals("EnergySiteInfoWidget", EnergySiteInfoRegistration.SLUG)
        assertEquals(EnergySiteInfoSize(cols = 2, rows = 4), EnergySiteInfoRegistration.defaultSize)
        assertEquals(EnergySiteInfoSize(cols = 1, rows = 2), EnergySiteInfoRegistration.minSize)
        assertEquals(EnergySiteInfoSize(cols = 4, rows = 40), EnergySiteInfoRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(EnergySiteInfoSize(cols = 4, rows = 40), EnergySiteInfoRegistration.clamp(EnergySiteInfoSize(9, 99)))
        assertEquals(EnergySiteInfoSize(cols = 1, rows = 2), EnergySiteInfoRegistration.clamp(EnergySiteInfoSize(0, 0)))
        assertTrue(EnergySiteInfoRegistration.isWithinBounds(EnergySiteInfoSize(2, 4)))
        assertFalse(EnergySiteInfoRegistration.isWithinBounds(EnergySiteInfoSize(5, 4)))
    }

    @Test
    fun compactBranchFollowsColumnCount() {
        assertTrue(EnergySiteInfoSize(cols = 1, rows = 4).isCompact)
        assertFalse(EnergySiteInfoSize(cols = 2, rows = 4).isCompact)
    }
}
