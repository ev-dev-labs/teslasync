package io.teslasync.android.analytics.periodcompare

import io.teslasync.android.data.UnitPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free PeriodComparePage derivations (PeriodComparePageModel.kt): the six-metric
 * roll-up + its display-unit conversions, the signed percent-change fold, and the locale number formatting. These
 * run in the `:android:testDebugUnitTest` gate, independent of Compose/Android.
 */
class PeriodComparePageModelTest {
    // Metric (km, en-US) defaults — the same resolution the live unit formatter applies before settings load.
    private val metricPrefs = UnitPreferences.fromSettings(null)

    @Test
    fun buildComparison_producesTheSixMetricsInWebOrder() {
        val a = PeriodStats(totalDistance = 1000.0, totalDrives = 50, energyUsed = 200.0, avgEfficiency = 150.0, totalCost = 80.0, co2Saved = 120.0)
        val b = PeriodStats(totalDistance = 800.0, totalDrives = 40, energyUsed = 180.0, avgEfficiency = 160.0, totalCost = 90.0, co2Saved = 100.0)

        val comparison = buildComparison(a, b, metricPrefs)

        assertEquals(6, comparison.metrics.size)
        assertEquals(
            listOf(
                MetricKind.Distance,
                MetricKind.Drives,
                MetricKind.Energy,
                MetricKind.Efficiency,
                MetricKind.Cost,
                MetricKind.Co2,
            ),
            comparison.metrics.map { it.kind },
        )
    }

    @Test
    fun distanceMetric_keepsKilometresForMetricUserAndCarriesTheUnit() {
        val a = PeriodStats(totalDistance = 1234.0)
        val b = PeriodStats(totalDistance = 1000.0)

        val distance = buildComparison(a, b, metricPrefs).metrics.first { it.kind == MetricKind.Distance }

        // A km-unit user: total_distance (km) -> SI metres -> back to km is the same magnitude.
        assertEquals(1234.0, distance.a, 0.0001)
        assertEquals(1000.0, distance.b, 0.0001)
        assertEquals(234.0, distance.change, 0.0001)
        assertEquals("km", distance.unit)
    }

    @Test
    fun efficiencyMetric_carriesWhPerKmForMetricUser() {
        val stats = PeriodStats(avgEfficiency = 150.0)

        val efficiency = buildComparison(stats, stats, metricPrefs).metrics.first { it.kind == MetricKind.Efficiency }

        assertEquals(150.0, efficiency.a, 0.0001)
        assertEquals("Wh/km", efficiency.unit)
    }

    @Test
    fun pctChange_signsPositiveAndNegativeChanges() {
        val up = pctChange(120.0, 100.0, "en-US")
        assertTrue(up.positive)
        assertEquals("+20.0%", up.text)

        val down = pctChange(80.0, 100.0, "en-US")
        assertFalse(down.positive)
        assertEquals("-20.0%", down.text)
    }

    @Test
    fun pctChange_zeroBaselineIsTheEmDash() {
        val change = pctChange(5.0, 0.0, "en-US")
        assertEquals(EM_DASH, change.text)
        assertTrue(change.positive)
    }

    @Test
    fun formatNumber_groupsThousandsAndRoundsHalfUp() {
        assertEquals("1,234.50", formatNumber(1234.5, "en-US", 2))
        assertEquals("1,235", formatNumber(1234.5, "en-US", 0))
        assertEquals("0.00", formatNumber(Double.NaN, "en-US", 2))
    }

    @Test
    fun periodValue_resolvesWireTokensAndFallsBackToThirtyDays() {
        assertEquals(PeriodValue.LAST_7, PeriodValue.fromRaw("7"))
        assertEquals(PeriodValue.ALL_TIME, PeriodValue.fromRaw("0"))
        assertEquals(0, PeriodValue.ALL_TIME.days)
        assertEquals(PeriodValue.LAST_30, PeriodValue.fromRaw("nonsense"))
    }
}
