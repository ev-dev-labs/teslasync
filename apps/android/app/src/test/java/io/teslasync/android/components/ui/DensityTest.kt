package io.teslasync.android.components.ui

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the density resolution in `Density.kt` (gate-run). Verifies the three tiers
 * are distinct and ordered, and that the comfortable tier keeps a >=48 dp touch target.
 */
class DensityTest {
    @Test
    fun tiersAreDistinctAndOrdered() {
        val compact = UiDensity.Compact.metrics()
        val comfortable = UiDensity.Comfortable.metrics()
        val spacious = UiDensity.Spacious.metrics()

        assertTrue(compact.rowHeight < comfortable.rowHeight)
        assertTrue(comfortable.rowHeight < spacious.rowHeight)
        assertTrue(compact.paddingX < comfortable.paddingX)
        assertTrue(comfortable.paddingX < spacious.paddingX)
    }

    @Test
    fun comfortableMeetsTouchTargetMinimum() {
        assertTrue(UiDensity.Comfortable.metrics().rowHeight >= 48.dp)
    }

    @Test
    fun controlHeightTracksRowHeight() {
        UiDensity.entries.forEach { density ->
            val metrics = density.metrics()
            assertEquals(metrics.rowHeight, metrics.controlHeight)
        }
    }
}
