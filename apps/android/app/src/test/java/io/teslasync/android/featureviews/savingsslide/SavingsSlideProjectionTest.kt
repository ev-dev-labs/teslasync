package io.teslasync.android.featureviews.savingsslide

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the SavingsSlide's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/review/SavingsSlide.tsx): the
 * `gasCostEquiv = gas_savings + total_charging_cost` total, the two `$${Math.round(value)}` bar figures, the
 * `gasCostEquiv > 0 ? Math.round(total_charging_cost / gasCostEquiv * 100) : 0` bar-width percent, and the
 * `Math.round(gas_savings / 5)` cups-of-coffee count. Because the surface is purely presentational each
 * [SavingsSlideDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot" (typical, large, and the all-zero "empty" rendering). Runs in the
 * :android:testReleaseUnitTest gate.
 *
 * Note the deliberate, web-faithful formatting asymmetry: the bar figures are bare, un-grouped integers
 * (`$12000`), while the headline grouping (`$12,000`) is a render-boundary concern applied by the composable
 * via the shared `ChartFormat`/`AnimatedNumber` and so is not part of this projection.
 */
class SavingsSlideProjectionTest {
    // ── project(): per-state snapshots ───────────────────────────────────────────

    @Test
    fun projectsTypicalSavingsPayload() {
        val display = SavingsSlideProjection.project(SavingsData(gasSavings = 1200.0, totalChargingCost = 300.0))

        assertEquals(1200.0, display.gasSavings, 0.0)
        // gasCostEquiv = 1200 + 300 = 1500.
        assertEquals("\$1500", display.gasCostText)
        assertEquals("\$300", display.electricCostText)
        // round(300 / 1500 * 100) = 20.
        assertEquals(20, display.electricBarPercent)
        // round(1200 / 5) = 240.
        assertEquals(240L, display.cupsOfCoffee)
    }

    @Test
    fun projectsZeroPayloadAsARenderableEmptySlideNeverBlank() {
        // Web renders the same structure for an all-zero payload: "$0" / "$0" / a 0% bar / "0 cups", never a
        // hidden or blank surface.
        val display = SavingsSlideProjection.project(SavingsData(gasSavings = 0.0, totalChargingCost = 0.0))

        assertEquals(0.0, display.gasSavings, 0.0)
        assertEquals("\$0", display.gasCostText)
        assertEquals("\$0", display.electricCostText)
        assertEquals(0, display.electricBarPercent)
        assertEquals(0L, display.cupsOfCoffee)
    }

    @Test
    fun barFiguresAreBareUngroupedIntegersLikeTheWebTemplateLiteral() {
        // Web `$${Math.round(value)}` renders a bare number — no locale grouping (that is the headline's job).
        val display = SavingsSlideProjection.project(SavingsData(gasSavings = 10_000.0, totalChargingCost = 2_000.0))

        assertEquals("\$12000", display.gasCostText)
        assertEquals("\$2000", display.electricCostText)
    }

    // ── gasCostEquiv(): web `gas_savings + total_charging_cost` ──────────────────

    @Test
    fun gasCostEquivSumsSavingsAndChargingCost() {
        assertEquals(1500.0, SavingsSlideProjection.gasCostEquiv(SavingsData(1200.0, 300.0)), 0.0)
        assertEquals(0.0, SavingsSlideProjection.gasCostEquiv(SavingsData(0.0, 0.0)), 0.0)
    }

    // ── dollars(): web `$${Math.round(value)}` (ties → +inf, non-finite → 0) ─────

    @Test
    fun dollarsRoundsTiesTowardsPositiveInfinityLikeMathRound() {
        assertEquals("\$1235", SavingsSlideProjection.dollars(1234.5))
        assertEquals("\$3", SavingsSlideProjection.dollars(2.5))
        assertEquals("\$4", SavingsSlideProjection.dollars(3.5))
        assertEquals("\$2", SavingsSlideProjection.dollars(2.4))
        assertEquals("\$3", SavingsSlideProjection.dollars(2.6))
        assertEquals("\$0", SavingsSlideProjection.dollars(0.0))
    }

    @Test
    fun dollarsCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("\$0", SavingsSlideProjection.dollars(Double.NaN))
        assertEquals("\$0", SavingsSlideProjection.dollars(Double.POSITIVE_INFINITY))
        assertEquals("\$0", SavingsSlideProjection.dollars(Double.NEGATIVE_INFINITY))
    }

    // ── electricBarPercent(): web guarded `round(charging / equiv * 100)` ────────

    @Test
    fun electricBarPercentGuardsNonPositiveTotals() {
        // Web `gasCostEquiv > 0 ? … : 0` — a zero or negative total yields a 0% bar, never a NaN width.
        assertEquals(0, SavingsSlideProjection.electricBarPercent(totalChargingCost = 0.0, gasCostEquiv = 0.0))
        assertEquals(0, SavingsSlideProjection.electricBarPercent(totalChargingCost = 50.0, gasCostEquiv = -10.0))
    }

    @Test
    fun electricBarPercentRoundsTheShareToAWholePercent() {
        assertEquals(20, SavingsSlideProjection.electricBarPercent(totalChargingCost = 300.0, gasCostEquiv = 1500.0))
        assertEquals(
            100,
            SavingsSlideProjection.electricBarPercent(totalChargingCost = 1500.0, gasCostEquiv = 1500.0),
        )
        // round(33.33…) = 33, round(66.66…) = 67.
        assertEquals(33, SavingsSlideProjection.electricBarPercent(totalChargingCost = 1.0, gasCostEquiv = 3.0))
        assertEquals(67, SavingsSlideProjection.electricBarPercent(totalChargingCost = 2.0, gasCostEquiv = 3.0))
    }

    // ── cupsOfCoffee(): web `Math.round(gas_savings / 5)` ────────────────────────

    @Test
    fun cupsOfCoffeeRoundsTheFiveDollarShareAndGuardsNonFinite() {
        assertEquals(240L, SavingsSlideProjection.cupsOfCoffee(1200.0))
        // 12.5 / 5 = 2.5 → 3 (ties → +inf); 7 / 5 = 1.4 → 1.
        assertEquals(3L, SavingsSlideProjection.cupsOfCoffee(12.5))
        assertEquals(1L, SavingsSlideProjection.cupsOfCoffee(7.0))
        assertEquals(0L, SavingsSlideProjection.cupsOfCoffee(0.0))
        assertEquals(0L, SavingsSlideProjection.cupsOfCoffee(Double.NaN))
    }

    // ── adapter: decode straight off the cached /analytics/year-review JSON ──────

    @Test
    fun projectsStraightOffCachedYearReviewJsonIgnoringOtherColumns() {
        // The data-adapter path: the owning slideshow caches the full YearReview payload, which carries dozens
        // of columns this slide does not read (snake_case on the wire). Decoding + projecting must yield the
        // rendered view from just `gas_savings` + `total_charging_cost`.
        val lenientJson = Json { ignoreUnknownKeys = true }
        val json =
            """
            {
              "year": 2025,
              "total_drives": 412,
              "total_distance_km": 18234.5,
              "total_energy_kwh": 3120.7,
              "total_charge_sessions": 96,
              "total_driving_minutes": 21540,
              "total_charging_cost": 642.0,
              "gas_savings": 2310.0,
              "co2_offset_kg": 1180.4,
              "most_active_day_of_week": "Saturday"
            }
            """.trimIndent()

        val decoded = lenientJson.decodeFromString<SavingsData>(json)
        assertEquals(2310.0, decoded.gasSavings, 0.0)
        assertEquals(642.0, decoded.totalChargingCost, 0.0)

        val display = SavingsSlideProjection.project(decoded)
        // gasCostEquiv = 2310 + 642 = 2952.
        assertEquals("\$2952", display.gasCostText)
        assertEquals("\$642", display.electricCostText)
        // round(642 / 2952 * 100) = round(21.74…) = 22.
        assertEquals(22, display.electricBarPercent)
        // round(2310 / 5) = 462.
        assertEquals(462L, display.cupsOfCoffee)
        assertEquals(2310.0, display.gasSavings, 0.0)
    }

    @Test
    fun decodesAMissingFieldAsZeroLikeWebOptionalChaining() {
        // A partial payload (only one of the two fields present) must decode without error, the absent field
        // collapsing to 0 — the web `data?.x ?? 0` behaviour.
        val lenientJson = Json { ignoreUnknownKeys = true }
        val decoded = lenientJson.decodeFromString<SavingsData>("""{ "gas_savings": 500.0 }""")

        assertEquals(500.0, decoded.gasSavings, 0.0)
        assertEquals(0.0, decoded.totalChargingCost, 0.0)

        val display = SavingsSlideProjection.project(decoded)
        assertEquals("\$500", display.gasCostText)
        assertEquals("\$0", display.electricCostText)
        // total is 0 of a 500 equiv → 0%.
        assertEquals(0, display.electricBarPercent)
        assertEquals(100L, display.cupsOfCoffee)
    }
}
