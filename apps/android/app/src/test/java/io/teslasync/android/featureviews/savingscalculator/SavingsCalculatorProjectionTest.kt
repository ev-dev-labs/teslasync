package io.teslasync.android.featureviews.savingscalculator

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the Savings-Calculator surface's pure logic — the native analogue of the web
 * parent's gasComparison memo and the component's per-card reads
 * (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx + useCostAnalysisData.ts): the
 * comparison formula, the per-field `Number(value) || fallback` input coercion, the four-card display
 * projection (the EV card showing the ACTUAL cost, not the theoretical one), the card content description, and
 * the top-level surface classifier. Runs in the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class SavingsCalculatorProjectionTest {
    private val stats =
        SavingsBaseStats(totalEnergyKwh = 300.0, totalCost = 50.0, totalDistanceDisplay = 900.0, monthCount = 5)
    private val assumptions = SavingsAssumptions(gasPrice = 3.5, mpg = 30.0, electricityRate = 0.13)

    // ── Comparison formula (web useCostAnalysisData gasComparison memo) ──────────────

    @Test
    fun computeComparisonReproducesWebFormula() {
        val comparison = SavingsCalculatorProjection.computeComparison(stats, assumptions)!!

        // gallonsNeeded = 900 / 30 = 30; gasCost = 30 * 3.5 = 105.
        assertEquals(105.0, comparison.gasCost, EPS)
        // evCost (theoretical) = 300 * 0.13 = 39.
        assertEquals(39.0, comparison.evCost, EPS)
        // actualCost is the recorded charging cost.
        assertEquals(50.0, comparison.actualCost, EPS)
        // savings compares gas cost to the ACTUAL cost: 105 - 50 = 55.
        assertEquals(55.0, comparison.savings, EPS)
        // monthlySavings annualizes the gas-vs-theoretical delta: (105 - 39) / 5 = 13.2.
        assertEquals(13.2, comparison.monthlySavings, EPS)
        assertEquals(13.2 * 12, comparison.yearlySavings, EPS)
        assertEquals(105.0 / 900.0, comparison.costPerDistanceGas, EPS)
        // costPerDistanceEV uses the actual cost, not the theoretical evCost.
        assertEquals(50.0 / 900.0, comparison.costPerDistanceEV, EPS)
    }

    @Test
    fun computeComparisonReturnsNullWhenNoBaseStats() {
        assertNull(SavingsCalculatorProjection.computeComparison(null, assumptions))
    }

    @Test
    fun computeComparisonZeroDistanceYieldsZeroRates() {
        val comparison =
            SavingsCalculatorProjection.computeComparison(stats.copy(totalDistanceDisplay = 0.0), assumptions)!!
        assertEquals(0.0, comparison.gasCost, EPS)
        assertEquals(0.0, comparison.costPerDistanceGas, EPS)
        assertEquals(0.0, comparison.costPerDistanceEV, EPS)
    }

    @Test
    fun computeComparisonZeroMonthsYieldsZeroMonthlyAndYearly() {
        val comparison = SavingsCalculatorProjection.computeComparison(stats.copy(monthCount = 0), assumptions)!!
        assertEquals(0.0, comparison.monthlySavings, EPS)
        assertEquals(0.0, comparison.yearlySavings, EPS)
    }

    // ── Input coercion (web Number(value) || fallback) ──────────────────────────────

    @Test
    fun coerceAssumptionKeepsFiniteNonZeroAndFallsBackOtherwise() {
        assertEquals(3.5, coerceAssumption("3.5", ZERO_FALLBACK), EPS)
        assertEquals(30.0, coerceAssumption(" 30 ", MPG_FALLBACK), EPS)
        assertEquals(ZERO_FALLBACK, coerceAssumption("", ZERO_FALLBACK), EPS)
        assertEquals(ZERO_FALLBACK, coerceAssumption("abc", ZERO_FALLBACK), EPS)
        // "0" is falsy in the web `||`, so it falls back per field (gas/elec → 0, mpg → 1).
        assertEquals(ZERO_FALLBACK, coerceAssumption("0", ZERO_FALLBACK), EPS)
        assertEquals(MPG_FALLBACK, coerceAssumption("0", MPG_FALLBACK), EPS)
    }

    @Test
    fun assumptionsFromInputAppliesPerFieldFallbacks() {
        val empty = assumptionsFromInput("", "", "")
        assertEquals(0.0, empty.gasPrice, EPS)
        assertEquals(1.0, empty.mpg, EPS)
        assertEquals(0.0, empty.electricityRate, EPS)

        val typed = assumptionsFromInput("4.25", "32", "0.18")
        assertEquals(4.25, typed.gasPrice, EPS)
        assertEquals(32.0, typed.mpg, EPS)
        assertEquals(0.18, typed.electricityRate, EPS)
    }

    @Test
    fun defaultAssumptionTextStripsWholeNumberDecimal() {
        assertEquals("30", defaultAssumptionText(DEFAULT_MPG))
        assertEquals("3.5", defaultAssumptionText(DEFAULT_GAS_PRICE))
        assertEquals("0.13", defaultAssumptionText(DEFAULT_ELECTRICITY_RATE))
    }

    // ── Card display projection (web per-card reads) ─────────────────────────────────

    @Test
    fun projectCardsMapsEveryWebCardWithEvUsingActualCost() {
        val comparison = SavingsCalculatorProjection.computeComparison(stats, assumptions)!!
        val currency: (Double, Int) -> String = { value, digits -> "[$digits]$value" }

        val cards =
            SavingsCalculatorProjection.projectCards(
                comparison = comparison,
                distanceUnit = "mi",
                currency = currency,
                overPeriodLabel = "over selected period",
                perYearLabel = "/ year",
            )

        assertEquals("[2]${comparison.gasCost}", cards.gas.value)
        assertEquals("[3]${comparison.costPerDistanceGas}/mi", cards.gas.sub)
        // EV card value is the ACTUAL cost, never the theoretical evCost.
        assertEquals("[2]${comparison.actualCost}", cards.ev.value)
        assertEquals("[3]${comparison.costPerDistanceEV}/mi", cards.ev.sub)
        assertEquals("[2]${comparison.savings}", cards.total.value)
        assertEquals("over selected period", cards.total.sub)
        assertEquals("[2]${comparison.monthlySavings}", cards.monthly.value)
        assertEquals("~[0]${comparison.yearlySavings} / year", cards.monthly.sub)
    }

    @Test
    fun cardDescriptionCombinesLabelValueAndSub() {
        val description =
            SavingsCalculatorProjection.cardDescription(
                label = "Total Savings",
                content = SavingsCardContent(value = "\$55.00", sub = "over selected period"),
            )
        assertEquals("Total Savings: \$55.00, over selected period", description)
    }

    // ── Surface classifier (web has-comparison vs not, plus lifecycle chrome) ────────

    @Test
    fun savingsSurfaceForClassifiesLifecycle() {
        assertEquals(SavingsSurfaceState.Loading, savingsSurfaceFor(isLoading = true, isError = false))
        assertEquals(SavingsSurfaceState.Error, savingsSurfaceFor(isLoading = false, isError = true))
        assertEquals(SavingsSurfaceState.Ready, savingsSurfaceFor(isLoading = false, isError = false))
        // Loading takes precedence over a concurrent error flag.
        assertEquals(SavingsSurfaceState.Loading, savingsSurfaceFor(isLoading = true, isError = true))
    }

    private companion object {
        const val EPS: Double = 1e-9
    }
}
