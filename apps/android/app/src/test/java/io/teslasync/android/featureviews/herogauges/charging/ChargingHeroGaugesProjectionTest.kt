package io.teslasync.android.featureviews.herogauges.charging

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the charging HeroGauges' pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/charging/components/charging-list/HeroGauges.tsx): the two render
 * branches (`!stats` EmptyState vs the resolved five-cell grid), the `Math.round` gauge values, the gauge max
 * floors, the units, and the round-to-2 avg-$/kWh pre-round. Because the surface is purely presentational,
 * each [ChargingHeroGaugesDisplay] is exactly what the thin composable renders, so these assertions double as
 * the per-state "snapshot"; the non-blank label/message checks additionally verify every cell stays accessible
 * (TalkBack-readable) in every state.
 */
class ChargingHeroGaugesProjectionTest {
    private val strings =
        ChargingHeroGaugesStrings(
            sessions = "Sessions",
            energy = "Energy",
            totalCost = "Total Cost",
            avgPower = "Avg Power",
            avgCostPerKwh = "Avg $/kWh",
            noStats = "No charging statistics available yet",
        )

    private val sample =
        ChargingStats(
            count = 128.0,
            totalEnergy = 2456.0,
            totalCost = 612.0,
            avgPower = 48.0,
            avgCostPerKwh = 0.18,
        )

    // ── Surface contract constants ────────────────────────────────────────────────

    @Test
    fun projectionContractMatchesTheWebComposition() {
        assertEquals(4, ChargingHeroGaugesProjection.GAUGE_COUNT)
        assertEquals(5, ChargingHeroGaugesProjection.CELL_COUNT)
        assertEquals("$", ChargingHeroGaugesProjection.CURRENCY_SYMBOL)
        assertEquals(3, ChargingHeroGaugesProjection.AVG_COST_DISPLAY_DECIMALS)
    }

    // ── project(): per-state ──────────────────────────────────────────────────────

    @Test
    fun nullStatsProjectsTheEmptyBranchWithNoGauges() {
        val display = ChargingHeroGaugesProjection.project(stats = null, strings = strings)

        assertTrue(display.empty)
        assertTrue(display.gauges.isEmpty())
        assertEquals("No charging statistics available yet", display.emptyMessage)
    }

    @Test
    fun resolvedStatsProjectsEveryGaugeInWebOrder() {
        val display = ChargingHeroGaugesProjection.project(sample, strings)
        assertFalse(display.empty)
        assertEquals(ChargingHeroGaugesProjection.GAUGE_COUNT, display.gauges.size)

        val sessions = display.gauges[0]
        assertEquals("Sessions", sessions.label)
        assertEquals(128.0, sessions.value, 0.0)
        assertEquals(128.0, sessions.max, 0.0)
        assertEquals("", sessions.unit)
        assertEquals(ChargingGaugeAccent.Sessions, sessions.accent)

        val energy = display.gauges[1]
        assertEquals("Energy", energy.label)
        assertEquals(2456.0, energy.value, 0.0)
        assertEquals(2456.0, energy.max, 0.0)
        assertEquals("kWh", energy.unit)
        assertEquals(ChargingGaugeAccent.Energy, energy.accent)

        val cost = display.gauges[2]
        assertEquals("Total Cost", cost.label)
        assertEquals(612.0, cost.value, 0.0)
        assertEquals(612.0, cost.max, 0.0)
        assertEquals("$", cost.unit)
        assertEquals(ChargingGaugeAccent.Cost, cost.accent)

        val power = display.gauges[3]
        assertEquals("Avg Power", power.label)
        assertEquals(48.0, power.value, 0.0)
        assertEquals(250.0, power.max, 0.0)
        assertEquals("kW", power.unit)
        assertEquals(ChargingGaugeAccent.Power, power.accent)

        assertEquals(0.18, display.avgCostPerKwh, 1e-9)
        assertEquals("Avg $/kWh", display.avgCostLabel)
    }

    @Test
    fun maxFloorsMatchTheWebMathMaxGuards() {
        // Web `Math.max(count,50)`, `Math.max(totalEnergy,500)`, `Math.max(totalCost,100)`, fixed power max 250.
        val small = ChargingStats(count = 3.0, totalEnergy = 12.0, totalCost = 7.0, avgPower = 5.0, avgCostPerKwh = 0.0)

        val gauges = ChargingHeroGaugesProjection.project(small, strings).gauges

        assertEquals(50.0, gauges[0].max, 0.0)
        assertEquals(500.0, gauges[1].max, 0.0)
        assertEquals(100.0, gauges[2].max, 0.0)
        assertEquals(250.0, gauges[3].max, 0.0)
    }

    @Test
    fun gaugeValuesRoundHalfTowardPositiveInfinityLikeMathRound() {
        val fractional =
            ChargingStats(count = 10.0, totalEnergy = 2456.7, totalCost = 611.5, avgPower = 48.4, avgCostPerKwh = 0.0)

        val gauges = ChargingHeroGaugesProjection.project(fractional, strings).gauges

        assertEquals(2457.0, gauges[1].value, 0.0)
        assertEquals(612.0, gauges[2].value, 0.0)
        assertEquals(48.0, gauges[3].value, 0.0)
    }

    @Test
    fun avgCostPreRoundsToTwoDecimals() {
        // Web `parseFloat(fmtNumber(avgCostPerKwh ?? 0, 2))`: round to 2 dp before the 3-dp count-up renders it.
        assertEquals(0.16, ChargingHeroGaugesProjection.project(sample.copy(avgCostPerKwh = 0.156), strings).avgCostPerKwh, 1e-9)
        assertEquals(0.18, ChargingHeroGaugesProjection.project(sample.copy(avgCostPerKwh = 0.182), strings).avgCostPerKwh, 1e-9)
    }

    @Test
    fun resolvedZeroStatsStillRendersGaugesNeverTheEmptyBranch() {
        // Web `stats ? ...` is truthy for any non-null object — an all-zero stats renders the grid, not EmptyState.
        val zeros = ChargingStats(0.0, 0.0, 0.0, 0.0, 0.0)

        val display = ChargingHeroGaugesProjection.project(zeros, strings)

        assertFalse(display.empty)
        assertEquals(ChargingHeroGaugesProjection.GAUGE_COUNT, display.gauges.size)
        assertEquals(0.0, display.gauges[0].value, 0.0)
        assertEquals(0.0, display.gauges[1].value, 0.0)
        assertEquals(0.0, display.gauges[2].value, 0.0)
        assertEquals(0.0, display.gauges[3].value, 0.0)
        assertEquals(0.0, display.avgCostPerKwh, 0.0)
    }

    @Test
    fun everyCellCarriesANonBlankLabelInEveryState() {
        // Accessibility: each gauge + the avg-cost cell + the empty message stay TalkBack-readable in any state.
        listOf(
            ChargingHeroGaugesProjection.project(sample, strings),
            ChargingHeroGaugesProjection.project(ChargingStats(0.0, 0.0, 0.0, 0.0, 0.0), strings),
        ).forEach { display ->
            assertEquals(ChargingHeroGaugesProjection.GAUGE_COUNT, display.gauges.size)
            display.gauges.forEach { gauge -> assertTrue("gauge label must not be blank", gauge.label.isNotBlank()) }
            assertTrue("avg-cost label must not be blank", display.avgCostLabel.isNotBlank())
        }
        val empty = ChargingHeroGaugesProjection.project(stats = null, strings = strings)
        assertTrue(empty.empty)
        assertTrue("empty message must not be blank", empty.emptyMessage.isNotBlank())
    }

    // ── ChargingStats.fromJson(): web `!stats` + `?? 0` parity ────────────────────

    @Test
    fun fromJsonTreatsNullAndJsonNullAsTheEmptyBranch() {
        assertNull(ChargingStats.fromJson(null))
        assertNull(ChargingStats.fromJson(JsonNull))
    }

    @Test
    fun fromJsonTreatsAnEmptyObjectAsResolvedZeros() {
        val stats = ChargingStats.fromJson(buildJsonObject {})

        assertNotNull(stats)
        assertEquals(0.0, stats!!.count, 0.0)
        assertEquals(0.0, stats.totalEnergy, 0.0)
        assertEquals(0.0, stats.totalCost, 0.0)
        assertEquals(0.0, stats.avgPower, 0.0)
        assertEquals(0.0, stats.avgCostPerKwh, 0.0)
    }

    @Test
    fun fromJsonParsesEverySnakeCaseField() {
        val stats =
            ChargingStats.fromJson(
                buildJsonObject {
                    put("count", 128.0)
                    put("total_energy", 2456.0)
                    put("total_cost", 612.0)
                    put("avg_power", 48.0)
                    put("avg_cost_per_kwh", 0.18)
                },
            )

        assertNotNull(stats)
        assertEquals(128.0, stats!!.count, 0.0)
        assertEquals(2456.0, stats.totalEnergy, 0.0)
        assertEquals(612.0, stats.totalCost, 0.0)
        assertEquals(48.0, stats.avgPower, 0.0)
        assertEquals(0.18, stats.avgCostPerKwh, 0.0)
    }

    @Test
    fun decodedEmptyObjectProjectsTheResolvedGridNotTheEmptyBranch() {
        // The cached "adapter -> projection" path: a present (even empty) cache document renders the grid.
        val display = ChargingHeroGaugesProjection.project(ChargingStats.fromJson(buildJsonObject {}), strings)

        assertFalse(display.empty)
        assertEquals(ChargingHeroGaugesProjection.GAUGE_COUNT, display.gauges.size)
    }
}
