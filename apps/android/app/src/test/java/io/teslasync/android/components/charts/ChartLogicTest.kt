package io.teslasync.android.components.charts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM unit tests for the framework-free chart logic in `ChartLogic.kt` / `ChartFormat.kt`.
 * These run in the `:android:testDebugUnitTest` gate and cover axis ranges, gap handling,
 * downsampling, sparkline/gauge geometry, the accessible summary + fallback table, CSV
 * escaping, and number formatting — without the Compose/Vico render layer.
 */
class ChartLogicTest {
    private val speed = ChartSeries("speed", "Speed", listOf(40.0, 55.0, null, 60.0, 52.0, 48.0, 63.0), unit = "km/h")
    private val power = ChartSeries("power", "Power", listOf(12.0, 18.0, 15.0, 20.0, 17.0, 14.0, 22.0), unit = "kW")
    private val series = listOf(speed, power)
    private val labels = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

    @Test
    fun finitePointsSkipsNullsAndKeepsIndices() {
        val points = finitePoints(listOf(1.0, null, 3.0, Double.NaN, 5.0))
        assertEquals(listOf(0 to 1.0, 2 to 3.0, 4 to 5.0), points)
    }

    @Test
    fun visibleExtentSpansAllSeriesAndHonorsHidden() {
        assertEquals(12.0..63.0, visibleExtent(series))
        assertEquals(40.0..63.0, visibleExtent(series, hiddenKeys = setOf("power")))
        assertNull(visibleExtent(emptyList()))
    }

    @Test
    fun niceAxisRangeRoundsToFriendlyBounds() {
        val range = niceAxisRange(0.0, 95.0, 5)
        assertEquals(0.0, range.min, EPS)
        assertEquals(100.0, range.max, EPS)
        assertEquals(20.0, range.step, EPS)
    }

    @Test
    fun niceAxisRangeGuardsFlatAndNonFinite() {
        val flat = niceAxisRange(50.0, 50.0)
        assertTrue(flat.min <= 50.0 && flat.max >= 50.0 && flat.step > 0.0)
        val nan = niceAxisRange(Double.NaN, 1.0)
        assertEquals(0.0, nan.min, EPS)
        assertEquals(1.0, nan.max, EPS)
    }

    @Test
    fun sampleIndicesPreservesFirstAndLast() {
        assertEquals(listOf(0, 1, 2), sampleIndices(3, 10))
        val sampled = sampleIndices(10, 4)
        assertEquals(0, sampled.first())
        assertEquals(9, sampled.last())
        assertTrue(sampled.size <= 5)
    }

    @Test
    fun strideSampleCapsLength() {
        val rows = (1..100).toList()
        val sampled = strideSample(rows, 10)
        assertTrue(sampled.size <= 11)
        assertEquals(1, sampled.first())
        assertEquals(100, sampled.last())
    }

    @Test
    fun sparklinePointsFitWithinBounds() {
        val points = sparklinePoints(listOf(3.0, 7.0, 4.0, 9.0, 6.0, 11.0), width = 100f, height = 30f)
        assertEquals(6, points.size)
        assertEquals(0f, points.first().x, EPS_F)
        assertEquals(100f, points.last().x, EPS_F)
        assertTrue(points.all { it.y in 0f..30f })
    }

    @Test
    fun sparklinePointsEmptyBelowTwoSamples() {
        assertTrue(sparklinePoints(listOf(1.0), 100f, 30f).isEmpty())
        assertTrue(sparklinePoints(emptyList(), 100f, 30f).isEmpty())
    }

    @Test
    fun gaugeFractionClampsToUnitInterval() {
        assertEquals(0.72f, gaugeFraction(72.0, 100.0), EPS_F)
        assertEquals(1f, gaugeFraction(150.0, 100.0), EPS_F)
        assertEquals(0f, gaugeFraction(-5.0, 100.0), EPS_F)
        assertEquals(0f, gaugeFraction(5.0, 0.0), EPS_F)
    }

    @Test
    fun elevationGainLossAccumulatesRiseAndFall() {
        val result = elevationGainLoss(listOf(120.0, 160.0, 140.0, 210.0, 190.0))
        assertEquals(110.0, result.gain, EPS)
        assertEquals(40.0, result.loss, EPS)
    }

    @Test
    fun toggleKeyAddsThenRemoves() {
        assertEquals(setOf("a"), toggleKey(emptySet(), "a"))
        assertEquals(emptySet<String>(), toggleKey(setOf("a"), "a"))
    }

    @Test
    fun clampWindowStaysInBounds() {
        assertEquals(1 to 3, clampWindow(1, 3, 7))
        assertEquals(5 to 7, clampWindow(10, 3, 7))
        assertEquals(1 to 7, clampWindow(1, 100, 7))
        assertEquals(0 to 0, clampWindow(1, 3, 0))
    }

    @Test
    fun fractionAndIndexAreInverse() {
        assertEquals(3, indexForFraction(0.5f, 7))
        assertEquals(0.5f, fractionForIndex(3, 7), EPS_F)
        assertEquals(0, indexForFraction(-1f, 7))
        assertEquals(6, indexForFraction(2f, 7))
    }

    @Test
    fun accessibleSummaryDescribesShapeAndSeries() {
        val summary = accessibleSummary(series, labels.size)
        assertTrue(summary.startsWith("Line chart with 2 series over 7 points."))
        assertTrue(summary.contains("Speed ranges"))
        assertTrue(summary.contains("Power ranges"))
    }

    @Test
    fun accessibleSummaryHandlesNoData() {
        assertEquals("Chart with no data.", accessibleSummary(emptyList(), 0))
    }

    @Test
    fun tableHeaderAndRowsMatchSeries() {
        assertEquals(listOf("Day", "Speed", "Power"), tableHeader(series, "Day"))
        val rows = tableRows(series, labels)
        assertEquals(7, rows.size)
        assertEquals(3, rows.first().size)
        assertEquals("Mon", rows.first().first())
        // The null Speed sample on Wed renders as the em dash.
        assertEquals(ChartFormat.EMPTY, rows[2][1])
    }

    @Test
    fun csvTextEscapesSeparatorsAndQuotes() {
        val text = csvText(listOf("a", "b,c"), listOf(listOf("1", "x\"y")))
        assertEquals("a,\"b,c\"\n1,\"x\"\"y\"\n", text)
    }

    @Test
    fun chartFormatRoundsAndMarksMissing() {
        assertEquals("40.0", ChartFormat.number(40.0, 1, Locale.US))
        assertEquals("60", ChartFormat.number(60.0, 0, Locale.US))
        assertEquals(ChartFormat.EMPTY, ChartFormat.number(null))
        assertEquals(ChartFormat.EMPTY, ChartFormat.number(Double.NaN))
        assertEquals("60 km/h", ChartFormat.withUnit(60.0, "km/h", 0, Locale.US))
        assertEquals(ChartFormat.EMPTY, ChartFormat.withUnit(null, "km/h"))
    }

    private companion object {
        const val EPS = 1e-6
        const val EPS_F = 1e-4f
    }
}
