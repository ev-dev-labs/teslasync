package io.teslasync.android.components.charts

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free chart adapter layer: the annotation → marker projection
 * ([annotationMarkers] + its category→severity mapping), the area-fill gradient ramp ([ChartGradient]),
 * and the shared sizing/behavior defaults ([ChartDefaults]). These run without the Compose/Vico render
 * layer; only the pure data adapters are exercised.
 */
class ChartAdaptersTest {
    // ── AnnotationModels ──────────────────────────────────────────────────────────────────────────

    @Test
    fun annotationMarkersMapEachCategoryToItsSeverity() {
        val annotations =
            listOf(
                DataAnnotation("1", 0, "issue", AnnotationCategory.Issue),
                DataAnnotation("2", 1, "maint", AnnotationCategory.Maintenance),
                DataAnnotation("3", 2, "trip", AnnotationCategory.Trip),
                DataAnnotation("4", 3, "mile", AnnotationCategory.Milestone),
                DataAnnotation("5", 4, "upgrade", AnnotationCategory.Upgrade),
                DataAnnotation("6", 5, "custom", AnnotationCategory.Custom),
            )
        val markers = annotationMarkers(annotations)

        assertEquals(MarkerSeverity.Critical, markers[0].severity)
        assertEquals(MarkerSeverity.Warn, markers[1].severity)
        assertEquals(MarkerSeverity.Success, markers[2].severity)
        assertEquals(MarkerSeverity.Info, markers[3].severity)
        assertEquals(MarkerSeverity.Info, markers[4].severity)
        assertEquals(MarkerSeverity.Info, markers[5].severity)
    }

    @Test
    fun annotationMarkersPreserveAnchorAndIdAndHandleEmpty() {
        assertTrue(annotationMarkers(emptyList()).isEmpty())

        val marker =
            annotationMarkers(
                listOf(DataAnnotation(id = "ann-9", index = 7, label = "Road trip", category = AnnotationCategory.Trip)),
            ).single()
        assertEquals(7, marker.index)
        assertEquals("Road trip", marker.label)
        assertEquals("ann-9", marker.id)
    }

    // ── ChartGradient ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun gradientAlphaConstantsAreTopHeavy() {
        assertEquals(0.30f, ChartGradient.TOP_ALPHA, EPS)
        assertEquals(0.02f, ChartGradient.BOTTOM_ALPHA, EPS)
        assertTrue(ChartGradient.TOP_ALPHA > ChartGradient.BOTTOM_ALPHA)
    }

    @Test
    fun gradientSolidAppliesAlphaAndKeepsColorChannels() {
        val base = Color(0xFF3B82F6)
        val default = ChartGradient.solid(base)
        assertEquals(ChartGradient.TOP_ALPHA, default.alpha, CHANNEL_EPS)
        assertEquals(base.red, default.red, CHANNEL_EPS)
        assertEquals(base.green, default.green, CHANNEL_EPS)
        assertEquals(base.blue, default.blue, CHANNEL_EPS)

        val half = ChartGradient.solid(base, alpha = 0.5f)
        assertEquals(0.5f, half.alpha, CHANNEL_EPS)
    }

    @Test
    fun gradientVerticalBrushIsBuilt() {
        assertNotNull(ChartGradient.verticalBrush(Color(0xFF10B981)))
    }

    // ── ChartDefaults ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun chartDefaultsAreStableAndOrdered() {
        assertEquals(5, ChartDefaults.AXIS_TICKS)
        assertEquals(1, ChartDefaults.DECIMALS)
        assertEquals(400, ChartDefaults.MAX_POINTS_PER_CELL)

        // Compact charts are shorter than full charts; sparklines are wider than they are tall.
        assertTrue(ChartDefaults.CompactHeight.value < ChartDefaults.Height.value)
        assertTrue(ChartDefaults.SparklineHeight.value < ChartDefaults.SparklineWidth.value)
        assertEquals(240f, ChartDefaults.Height.value, EPS)
        assertEquals(120f, ChartDefaults.GaugeSize.value, EPS)
    }

    private companion object {
        const val EPS = 1e-4f

        /** Color channels are quantized to 8 bits, so allow ~1/255 of slack on alpha round-trips. */
        const val CHANNEL_EPS = 0.01f
    }
}
