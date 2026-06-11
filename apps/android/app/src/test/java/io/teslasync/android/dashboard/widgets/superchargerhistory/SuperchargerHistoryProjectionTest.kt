package io.teslasync.android.dashboard.widgets.superchargerhistory

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
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
 * Off-device verification of the SuperchargerHistoryWidget's pure logic — the raw-SI-JSON decode, the
 * newest-first slice + ranked-by-energy re-sort + background-bar math the web composes from its `useMemo`
 * and the shared `WidgetRankedList`, the per-session cost-badge gate (web `cost > 0 ? … : undefined`), the
 * 30-day totals row, the compact-spend hero, the settings-derived display preferences, the TalkBack content
 * descriptions, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx).
 */
class SuperchargerHistoryProjectionTest {
    private val strings =
        SuperchargerHistoryStrings(
            title = "Supercharger History",
            currencyUnit = "$",
            compactLabel = "30-day Supercharger",
            noData = "No Supercharger sessions",
            totals = "30-day totals",
        )

    // Injected display formatters that echo their input so the projection's sort/slice/bar/badge logic is
    // asserted independently of the real unit-conversion + currency-grouping (those are covered separately).
    private val echoEnergy: (Double) -> String = { wh -> "E${wh.toInt()}" }
    private val echoCurrency: (Double) -> String = { amount -> "C$amount" }

    private fun entry(
        id: Long,
        date: String,
        usageWh: Double?,
        totalDue: Double? = 0.0,
        site: String = "S$id",
    ) = buildJsonObject {
        put("id", id)
        put("site_location_name", site)
        put("charge_start_datetime", date)
        if (usageWh != null) put("usage_wh", usageWh)
        if (totalDue != null) put("total_due", totalDue)
    }

    private fun payload(
        entries: List<kotlinx.serialization.json.JsonObject>,
        totalWh: Double = 0.0,
        totalSpend: Double = 0.0,
    ) = buildJsonObject {
        put(
            "entries",
            buildJsonArray { entries.forEach { add(it) } },
        )
        put(
            "summary",
            buildJsonObject {
                put("total_sessions", entries.size)
                put("total_wh", totalWh)
                put("total_spend", totalSpend)
            },
        )
    }

    private fun project(data: SuperchargerHistoryData): SuperchargerHistoryDisplay =
        SuperchargerHistoryProjection.project(
            data = data,
            strings = strings,
            formatEnergy = echoEnergy,
            formatCurrency = echoCurrency,
            locale = Locale.US,
        )

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseSuperchargerHistory(null)
        assertFalse(data.hasEntries)
        assertTrue(data.entries.isEmpty())
        assertEquals(SuperchargerSummary.EMPTY, data.summary)
    }

    @Test
    fun parseReadsSnakeCaseSiFields() {
        val data =
            parseSuperchargerHistory(
                payload(listOf(entry(7, "2025-01-05T10:00:00Z", 32000.0, 14.5, "Harris Ranch")), totalWh = 32000.0, totalSpend = 14.5),
            )
        assertEquals(1, data.entries.size)
        val first = data.entries.single()
        assertEquals(7L, first.id)
        assertEquals("Harris Ranch", first.siteLocationName)
        assertEquals(32000.0, first.usageWh!!, 0.0)
        assertEquals(14.5, first.totalDue!!, 0.0)
        assertEquals(32000.0, data.summary.totalWh, 0.0)
        assertEquals(14.5, data.summary.totalSpend, 0.0)
    }

    @Test
    fun parseTreatsMissingNumericsAsNullAndMissingSummaryAsZero() {
        val json =
            buildJsonObject {
                put(
                    "entries",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("id", 1)
                                put("charge_start_datetime", "2025-01-01T00:00:00Z")
                            },
                        )
                    },
                )
            }
        val data = parseSuperchargerHistory(json)
        val entry = data.entries.single()
        assertNull(entry.usageWh)
        assertNull(entry.totalDue)
        assertNull(entry.siteLocationName)
        assertEquals(SuperchargerSummary.EMPTY, data.summary)
    }

    @Test
    fun rankedListTakesNewestTenThenSortsByEnergyDescending() {
        // Twelve sessions: the two OLDEST (ids 1, 2) carry the highest energy. If the newest-first slice
        // were applied AFTER the energy sort they would top the list; the spec slices to the newest ten
        // FIRST, so they must be dropped entirely.
        val entries =
            listOf(
                entry(1, "2025-03-01T00:00:00Z", 9000.0),
                entry(2, "2025-03-02T00:00:00Z", 8000.0),
                entry(3, "2025-03-03T00:00:00Z", 100.0),
                entry(4, "2025-03-04T00:00:00Z", 700.0, totalDue = 5.0),
                entry(5, "2025-03-05T00:00:00Z", 300.0),
                entry(6, "2025-03-06T00:00:00Z", 900.0),
                entry(7, "2025-03-07T00:00:00Z", 200.0),
                entry(8, "2025-03-08T00:00:00Z", 1000.0, totalDue = 12.5),
                entry(9, "2025-03-09T00:00:00Z", 400.0),
                entry(10, "2025-03-10T00:00:00Z", 600.0),
                entry(11, "2025-03-11T00:00:00Z", 500.0),
                entry(12, "2025-03-12T00:00:00Z", 800.0),
            )
        val rows = project(parseSuperchargerHistory(payload(entries))).rankedRows

        assertEquals(10, rows.size)
        assertEquals(
            listOf("S8", "S6", "S12", "S4", "S10", "S11", "S9", "S5", "S7", "S3"),
            rows.map { it.label },
        )
        assertFalse(rows.any { it.label == "S1" || it.label == "S2" })
    }

    @Test
    fun barFractionIsEnergyOverVisibleMax() {
        val entries =
            listOf(
                entry(1, "2025-03-01T00:00:00Z", 1000.0),
                entry(2, "2025-03-02T00:00:00Z", 250.0),
                entry(3, "2025-03-03T00:00:00Z", 500.0),
            )
        val rows = project(parseSuperchargerHistory(payload(entries))).rankedRows
        assertEquals(1.0f, rows[0].barFraction, 1e-6f)
        assertEquals(0.5f, rows[1].barFraction, 1e-6f)
        assertEquals(0.25f, rows[2].barFraction, 1e-6f)
        assertEquals("E1000", rows[0].energyText)
    }

    @Test
    fun costBadgeOnlyWhenPositiveDue() {
        val entries =
            listOf(
                entry(1, "2025-03-01T00:00:00Z", 100.0, totalDue = 18.0),
                entry(2, "2025-03-02T00:00:00Z", 90.0, totalDue = 0.0),
                entry(3, "2025-03-03T00:00:00Z", 80.0, totalDue = null),
            )
        val rows = project(parseSuperchargerHistory(payload(entries))).rankedRows
        assertEquals("C18.0", rows[0].costBadge)
        assertNull(rows[1].costBadge)
        assertNull(rows[2].costBadge)
    }

    @Test
    fun unparseableDateSortsLastAndIsDroppedFromNewestTen() {
        val entries =
            (2..11).map { entry(it.toLong(), "2025-04-${it.toString().padStart(2, '0')}T00:00:00Z", it * 100.0) } +
                entry(1, "not-a-real-date", 5000.0, site = "S1")
        val rows = project(parseSuperchargerHistory(payload(entries))).rankedRows
        assertEquals(10, rows.size)
        assertFalse(rows.any { it.label == "S1" })
    }

    @Test
    fun rowContentDescriptionFoldsRankLabelEnergyAndCost() {
        val entries =
            listOf(
                entry(1, "2025-03-01T00:00:00Z", 1000.0, totalDue = 12.5, site = "Kettleman"),
                entry(2, "2025-03-02T00:00:00Z", 500.0, totalDue = 0.0, site = "Mojave"),
            )
        val rows = project(parseSuperchargerHistory(payload(entries))).rankedRows
        assertEquals("1. Kettleman, E1000, C12.5", rows[0].contentDescription)
        assertEquals("2. Mojave, E500", rows[1].contentDescription)
    }

    @Test
    fun missingSiteNameRendersEmDashLabel() {
        val noSite =
            buildJsonObject {
                put("id", 1)
                put("charge_start_datetime", "2025-03-01T00:00:00Z")
                put("usage_wh", 100.0)
            }
        val rows = project(parseSuperchargerHistory(payload(listOf(noSite)))).rankedRows
        assertEquals("\u2014", rows.single().label)
    }

    @Test
    fun totalsRowFormatsSummaryEnergyAndSpend() {
        val data = parseSuperchargerHistory(payload(listOf(entry(1, "2025-03-01T00:00:00Z", 100.0)), totalWh = 50000.0, totalSpend = 142.0))
        val display = project(data)
        assertEquals("30-day totals", display.totalsLabel)
        assertEquals("E50000", display.totalsEnergyText)
        assertEquals("C142.0", display.totalsCostText)
        assertEquals("30-day totals E50000 C142.0", display.totalsContentDescription)
    }

    @Test
    fun compactHeroUsesSummaryTotalSpend() {
        val data = parseSuperchargerHistory(payload(listOf(entry(1, "2025-03-01T00:00:00Z", 100.0)), totalSpend = 142.0))
        val display = project(data)
        assertTrue(display.hasEntries)
        assertEquals(142.0, display.compactSpendValue, 0.0)
        assertEquals(0, display.compactSpendDecimals)
        assertEquals("$", display.compactUnit)
        assertEquals("30-day Supercharger", display.compactLabel)
        assertEquals("30-day Supercharger 142 $", display.compactContentDescription)
    }

    @Test
    fun emptyDataProjectsNoRowsAndNoDataMessage() {
        val display = project(SuperchargerHistoryData.EMPTY)
        assertFalse(display.hasEntries)
        assertTrue(display.rankedRows.isEmpty())
        assertEquals("No Supercharger sessions", display.emptyMessage)
        assertEquals(0.0, display.compactSpendValue, 0.0)
    }

    @Test
    fun formatCurrencyGroupsAndPrefixesSymbol() {
        assertEquals("\$1,234.50", SuperchargerHistoryProjection.formatCurrency(1234.5, "$", 2, Locale.US))
        assertEquals("\u20AC9.999", SuperchargerHistoryProjection.formatCurrency(9.999, "\u20AC", 3, Locale.US))
        // Blank symbol falls back to "$" (web `currency_symbol` blank guard).
        assertEquals("\$5.00", SuperchargerHistoryProjection.formatCurrency(5.0, "  ", 2, Locale.US))
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        val default = SuperchargerHistoryDisplayPrefs.fromSettings(null)
        assertEquals("$", default.currencySymbol)
        assertEquals(2, default.precision)
        assertEquals(DistanceUnitPref.KM, default.unitPref.distance)
        assertEquals(EnergyUnitPref.KWH, default.unitPref.energy)

        val custom =
            SuperchargerHistoryDisplayPrefs.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3)
                },
            )
        assertEquals("\u20AC", custom.currencySymbol)
        assertEquals(3, custom.precision)
        assertEquals(DistanceUnitPref.MI, custom.unitPref.distance)

        val blank = SuperchargerHistoryDisplayPrefs.fromSettings(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", blank.currencySymbol)
        assertEquals(2, blank.precision)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("supercharger-history", SuperchargerHistoryRegistration.ID)
        assertEquals("charging", SuperchargerHistoryRegistration.CATEGORY)
        assertEquals("SuperchargerHistoryWidget", SuperchargerHistoryRegistration.SLUG)
        assertEquals(SuperchargerHistorySize(cols = 2, rows = 4), SuperchargerHistoryRegistration.defaultSize)
        assertEquals(SuperchargerHistorySize(cols = 1, rows = 2), SuperchargerHistoryRegistration.minSize)
        assertEquals(SuperchargerHistorySize(cols = 4, rows = 40), SuperchargerHistoryRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(SuperchargerHistorySize(cols = 4, rows = 40), SuperchargerHistoryRegistration.clamp(SuperchargerHistorySize(9, 99)))
        assertEquals(SuperchargerHistorySize(cols = 1, rows = 2), SuperchargerHistoryRegistration.clamp(SuperchargerHistorySize(0, 0)))
        assertTrue(SuperchargerHistoryRegistration.isWithinBounds(SuperchargerHistorySize(2, 4)))
        assertFalse(SuperchargerHistoryRegistration.isWithinBounds(SuperchargerHistorySize(5, 4)))
    }

    @Test
    fun compactBranchFollowsColumnCount() {
        assertTrue(SuperchargerHistorySize(cols = 1, rows = 4).isCompact)
        assertFalse(SuperchargerHistorySize(cols = 2, rows = 4).isCompact)
    }
}
