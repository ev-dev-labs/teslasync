package io.teslasync.android.widgets

import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the widget-local formatters (battery percent, counts, cost, derived efficiency). */
class WidgetFormattingTest {
    @Test
    fun socPercentClampsAndPasses() {
        assertNull(socPercentOf(null))
        assertEquals(80, socPercentOf(80))
        assertEquals(100, socPercentOf(120))
        assertEquals(0, socPercentOf(-5))
    }

    @Test
    fun percentFormatting() {
        assertEquals(WIDGET_EM_DASH, formatPercent(null))
        assertEquals("50%", formatPercent(50))
    }

    @Test
    fun countFormatting() {
        assertEquals("5", formatCount(5))
        assertEquals("0", formatCount(-3))
    }

    @Test
    fun costFromCents() {
        assertEquals(WIDGET_EM_DASH, formatCostFromCents(null))
        assertEquals("12.34", formatCostFromCents(1234))
        assertEquals("0.05", formatCostFromCents(5))
        assertEquals("1.00", formatCostFromCents(100))
    }

    @Test
    fun efficiencyDerivedFromSiTotals() {
        assertEquals(150.0, efficiencyWhPerDistanceUnit(150_000.0, 1_000_000.0, DistanceUnitPref.KM)!!, 0.001)
        assertEquals(241.4016, efficiencyWhPerDistanceUnit(150_000.0, 1_000_000.0, DistanceUnitPref.MI)!!, 0.001)
        assertNull(efficiencyWhPerDistanceUnit(150_000.0, 0.0, DistanceUnitPref.KM))
    }

    @Test
    fun efficiencyTextHasUnitAndEmDashFallback() {
        assertTrue(formatEfficiency(150_000.0, 1_000_000.0, metricFormatter).contains("Wh/"))
        assertEquals(WIDGET_EM_DASH, formatEfficiency(150_000.0, 0.0, metricFormatter))
    }
}
