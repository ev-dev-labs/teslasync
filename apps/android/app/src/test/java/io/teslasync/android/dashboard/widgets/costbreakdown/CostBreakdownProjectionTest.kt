package io.teslasync.android.dashboard.widgets.costbreakdown

import io.teslasync.shared.core.units.DistanceUnitPref
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
 * Off-device verification of the CostBreakdownWidget's pure logic — the raw-SI-JSON decode, the
 * currency formatting (web `useFormatting`), the SI cost-per-km → display-unit conversion, the donut /
 * ranked-list / stat-card / compact-hero projection branches, the TalkBack content descriptions, the
 * settings-derived display preferences, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx).
 */
class CostBreakdownProjectionTest {
    private val strings =
        CostBreakdownStrings(
            title = "Cost Breakdown",
            monthlyTotal = "This Month",
            savedVsGas = "Saved %1\$s vs gas",
            saving = "Saving",
            noData = "No cost data",
            totalCost = "Total Cost",
            costPerDist = "Cost / %1\$s",
            gasSavings = "Gas Savings",
            lifetime = "Lifetime",
        )

    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.MI,
        currency: String = "$",
        precision: Int = 2,
    ): CostBreakdownDisplayPrefs = CostBreakdownDisplayPrefs(distance, currency, precision)

    // Eight months so the donut last-6 slice and the ranked top-5 cap are both exercised.
    private fun sampleJson() =
        buildJsonObject {
            put("total_charging_cost", 280.0)
            put("cost_per_km_ev", 0.05)
            put("total_savings", 120.0)
            put("monthly_savings", 15.0)
            put(
                "monthly_breakdown",
                buildJsonArray {
                    add(month("2025-01", 10.0))
                    add(month("2025-02", 50.0))
                    add(month("2025-03", 20.0))
                    add(month("2025-04", 40.0))
                    add(month("2025-05", 30.0))
                    add(month("2025-06", 60.0))
                    add(month("2025-07", 25.0))
                    add(month("2025-08", 45.0))
                },
            )
        }

    private fun month(
        label: String,
        evCost: Double,
    ) = buildJsonObject {
        put("month", label)
        put("ev_cost", evCost)
    }

    private fun project(
        data: CostBreakdownData,
        prefs: CostBreakdownDisplayPrefs = prefs(),
    ): CostBreakdownDisplay = CostBreakdownProjection.project(data, prefs, strings, Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseCostBreakdown(null)
        assertFalse(data.hasData)
        assertEquals(0.0, data.totalChargingCost, 0.0)
        assertTrue(data.monthlyBreakdown.isEmpty())
    }

    @Test
    fun parseReadsSnakeCaseSiFields() {
        val data = parseCostBreakdown(sampleJson())
        assertEquals(280.0, data.totalChargingCost, 0.0)
        assertEquals(0.05, data.costPerKmEv, 0.0)
        assertEquals(120.0, data.totalSavings, 0.0)
        assertEquals(15.0, data.monthlySavings, 0.0)
        assertEquals(8, data.monthlyBreakdown.size)
        assertEquals(MonthlyCost("2025-08", 45.0), data.monthlyBreakdown.last())
    }

    @Test
    fun parseTreatsMissingNumericsAsZero() {
        val json =
            buildJsonObject {
                put(
                    "monthly_breakdown",
                    buildJsonArray { add(buildJsonObject { put("month", "2025-09") }) },
                )
            }
        val data = parseCostBreakdown(json)
        assertEquals(0.0, data.totalChargingCost, 0.0)
        assertEquals(MonthlyCost("2025-09", 0.0), data.monthlyBreakdown.single())
    }

    @Test
    fun compactHeroUsesLastMonthAndSavings() {
        val display = project(parseCostBreakdown(sampleJson()))
        assertTrue(display.hasData)
        assertEquals(45.0, display.monthlyTotalValue, 0.0)
        assertEquals("$", display.currencySymbol)
        assertEquals("Saved \$15.00 vs gas", display.savedSubtitle)
        assertTrue(display.showSavingBadge)
        assertEquals("This Month \$45.00, Saved \$15.00 vs gas, Saving", display.compactContentDescription)
    }

    @Test
    fun donutKeepsLastSixMonthsInOrder() {
        val display = project(parseCostBreakdown(sampleJson()))
        assertEquals(6, display.donutSegments.size)
        assertEquals(DonutSegment("2025-03", 20.0, 0), display.donutSegments.first())
        assertEquals(DonutSegment("2025-08", 45.0, 5), display.donutSegments.last())
        assertEquals("Cost Breakdown: 2025-03, 2025-04, 2025-05, 2025-06, 2025-07, 2025-08", display.donutContentDescription)
    }

    @Test
    fun rankedListSortsDescendingAndCapsAtFive() {
        val rows = project(parseCostBreakdown(sampleJson())).rankedRows
        assertEquals(5, rows.size)
        assertEquals(listOf(60.0, 50.0, 45.0, 40.0, 30.0), rows.map { it.value })
        val top = rows.first()
        assertEquals("2025-06", top.label)
        assertEquals("\$60.00", top.formattedValue)
        assertEquals(1.0f, top.barFraction)
        // Colour index follows the entry's ORIGINAL position (web assigns colour pre-sort): 2025-06 is index 5.
        assertEquals(5, top.colorIndex)
        assertEquals("1. 2025-06 \$60.00", top.contentDescription)
        assertEquals(0.5f, rows[4].barFraction)
    }

    @Test
    fun statCardsFormatTotalsAndSavings() {
        val display = project(parseCostBreakdown(sampleJson()))
        assertEquals(CostStatCard("Total Cost", "\$280.00", null), display.totalCostCard)
        assertEquals(CostStatCard("Gas Savings", "\$120.00", "Lifetime"), display.gasSavingsCard)
    }

    @Test
    fun costPerDistanceConvertsPerKmToPerMile() {
        val miles = project(parseCostBreakdown(sampleJson()), prefs(DistanceUnitPref.MI))
        // 0.05 $/km * 1.60934 = 0.080467 $/mi → 3 dp.
        assertEquals(CostStatCard("Cost / mi", "\$0.080", null), miles.costPerDistCard)

        val km = project(parseCostBreakdown(sampleJson()), prefs(DistanceUnitPref.KM))
        assertEquals(CostStatCard("Cost / km", "\$0.050", null), km.costPerDistCard)
    }

    @Test
    fun costPerDistanceHelperMatchesWebConstant() {
        assertEquals(0.0, CostBreakdownProjection.costPerDistance(0.0, DistanceUnitPref.MI), 0.0)
        assertEquals(0.05, CostBreakdownProjection.costPerDistance(0.05, DistanceUnitPref.KM), 1e-9)
        assertEquals(0.05 * CostBreakdownProjection.MI_TO_KM, CostBreakdownProjection.costPerDistance(0.05, DistanceUnitPref.MI), 1e-9)
    }

    @Test
    fun emptyDataProjectsEmDashesAndNoBadge() {
        val display = project(CostBreakdownData.EMPTY)
        assertFalse(display.hasData)
        assertTrue(display.donutSegments.isEmpty())
        assertTrue(display.rankedRows.isEmpty())
        assertNull(display.savedSubtitle)
        assertFalse(display.showSavingBadge)
        assertEquals("\u2014", display.costPerDistCard.value)
        assertEquals("\u2014", display.gasSavingsCard.value)
        assertNull(display.gasSavingsCard.sublabel)
        assertEquals("This Month \$0.00", display.compactContentDescription)
        assertEquals("No cost data", display.emptyMessage)
    }

    @Test
    fun formatCurrencyGroupsAndPrefixesSymbol() {
        assertEquals("\$1,234.50", CostBreakdownProjection.formatCurrency(1234.5, "$", 2, Locale.US))
        assertEquals("\u20AC9.999", CostBreakdownProjection.formatCurrency(9.999, "\u20AC", 3, Locale.US))
        // Blank symbol falls back to "$" (web `currency_symbol` blank guard).
        assertEquals("\$5.00", CostBreakdownProjection.formatCurrency(5.0, "  ", 2, Locale.US))
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(CostBreakdownDisplayPrefs.METRIC_DEFAULT, CostBreakdownDisplayPrefs.fromSettings(null))

        val custom =
            CostBreakdownDisplayPrefs.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3)
                },
            )
        assertEquals(CostBreakdownDisplayPrefs(DistanceUnitPref.MI, "\u20AC", 3), custom)

        val blankSymbol = CostBreakdownDisplayPrefs.fromSettings(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", blankSymbol.currencySymbol)
        assertEquals(2, blankSymbol.precision)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("cost-breakdown", CostBreakdownRegistration.ID)
        assertEquals("analytics", CostBreakdownRegistration.CATEGORY)
        assertEquals("CostBreakdownWidget", CostBreakdownRegistration.SLUG)
        assertEquals(CostBreakdownSize(cols = 2, rows = 4), CostBreakdownRegistration.defaultSize)
        assertEquals(CostBreakdownSize(cols = 1, rows = 2), CostBreakdownRegistration.minSize)
        assertEquals(CostBreakdownSize(cols = 4, rows = 40), CostBreakdownRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(CostBreakdownSize(cols = 4, rows = 40), CostBreakdownRegistration.clamp(CostBreakdownSize(9, 99)))
        assertEquals(CostBreakdownSize(cols = 1, rows = 2), CostBreakdownRegistration.clamp(CostBreakdownSize(0, 0)))
        assertTrue(CostBreakdownRegistration.isWithinBounds(CostBreakdownSize(2, 4)))
        assertFalse(CostBreakdownRegistration.isWithinBounds(CostBreakdownSize(5, 4)))
    }

    @Test
    fun compactBranchFollowsColumnCount() {
        assertTrue(CostBreakdownSize(cols = 1, rows = 4).isCompact)
        assertFalse(CostBreakdownSize(cols = 2, rows = 4).isCompact)
    }
}
