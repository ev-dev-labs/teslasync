package io.teslasync.android.featureviews.tripreplaycharts

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the TripReplayCharts' pure logic — the native analogue of the web component's
 * data derivations (web/src/features/trips/components/TripReplayCharts.tsx): the ordered speed/power value
 * columns + the per-sample axis ("Nm") and cursor ("N.N min") labels, the `data.length > 0` content/empty
 * boundary, the playhead `data[currentIndex]?.time` clamp, the click→`data[idx].index` seek mapping, the
 * exported `nearestIndexByTime` binary search (incl. the lower-index tie-break), the `fmt`/`safeNumber`
 * helpers, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class TripReplayChartsProjectionTest {
    private val trace =
        listOf(
            TripReplayChartPoint(index = 0, time = 0.0, speed = 0.0, power = 0.0),
            TripReplayChartPoint(index = 1, time = 1.5, speed = 42.0, power = 38.0),
            TripReplayChartPoint(index = 2, time = 3.0, speed = 80.0, power = -12.0),
        )

    // ── Projection: value columns + labels + order ────────────────────────────────

    @Test
    fun projectPreservesOrderAndBuildsSpeedPowerColumns() {
        val result = TripReplayChartsProjection.project(trace, Locale.US)

        assertEquals(listOf(0.0, 42.0, 80.0), result.speedValues)
        assertEquals(listOf(0.0, 38.0, -12.0), result.powerValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectBuildsAxisAndCursorLabelsWithWebSuffixes() {
        val result = TripReplayChartsProjection.project(trace, Locale.US)

        // Bottom axis: web `${fmt(v, 0)}m` (whole minutes); cursor: web `${fmt(v, 1)} min`.
        assertEquals(listOf("0m", "2m", "3m"), result.xLabels)
        assertEquals(listOf("0.0 min", "1.5 min", "3.0 min"), result.cursorLabels)
    }

    // ── Projection: content/empty boundary (web data.length > 0) ───────────────────

    @Test
    fun projectIsEmptyForZeroSamplesAndContentForOnePlus() {
        assertTrue(TripReplayChartsProjection.project(emptyList(), Locale.US).isEmpty)
        assertFalse(TripReplayChartsProjection.project(listOf(trace.first()), Locale.US).isEmpty)
        assertTrue(TripReplayChartsProjection.isEmpty(emptyList()))
        assertFalse(TripReplayChartsProjection.isEmpty(trace))
    }

    // ── Playhead clamp (web data[currentIndex]?.time guard) ────────────────────────

    @Test
    fun clampCursorIndexReturnsNullWhenEmptyAndClampsOtherwise() {
        assertNull(TripReplayChartsProjection.clampCursorIndex(0, 0))
        assertEquals(0, TripReplayChartsProjection.clampCursorIndex(-5, 3))
        assertEquals(2, TripReplayChartsProjection.clampCursorIndex(99, 3))
        assertEquals(1, TripReplayChartsProjection.clampCursorIndex(1, 3))
    }

    // ── Tap → index mapping (web onClick activeTooltipIndex) ───────────────────────

    @Test
    fun indexForFractionMapsAcrossThePlotWidth() {
        assertEquals(0, TripReplayChartsProjection.indexForFraction(0, 0.5f))
        assertEquals(0, TripReplayChartsProjection.indexForFraction(5, 0f))
        assertEquals(4, TripReplayChartsProjection.indexForFraction(5, 1f))
        assertEquals(2, TripReplayChartsProjection.indexForFraction(5, 0.5f))
        // Out-of-range fractions clamp to the ends.
        assertEquals(0, TripReplayChartsProjection.indexForFraction(5, -1f))
        assertEquals(4, TripReplayChartsProjection.indexForFraction(5, 2f))
    }

    @Test
    fun seekTargetForFractionReturnsThePositionsIndexNotTheArrayPosition() {
        // A down-sampled trace whose `index` differs from the chart-array position — the seek must use the
        // sample's `index` (web `data[idx].index`), not the array position, so the right frame is selected.
        val downsampled =
            listOf(
                TripReplayChartPoint(index = 10, time = 0.0, speed = 1.0, power = 1.0),
                TripReplayChartPoint(index = 25, time = 1.0, speed = 2.0, power = 2.0),
                TripReplayChartPoint(index = 40, time = 2.0, speed = 3.0, power = 3.0),
            )
        assertEquals(10, TripReplayChartsProjection.seekTargetForFraction(downsampled, 0f))
        assertEquals(25, TripReplayChartsProjection.seekTargetForFraction(downsampled, 0.5f))
        assertEquals(40, TripReplayChartsProjection.seekTargetForFraction(downsampled, 1f))
        assertNull(TripReplayChartsProjection.seekTargetForFraction(emptyList(), 0.5f))
    }

    // ── nearestIndexByTime (verbatim web binary-search port) ───────────────────────

    @Test
    fun nearestIndexByTimeFindsTheClosestSample() {
        // trace times: 0.0, 1.5, 3.0
        assertEquals(0, TripReplayChartsProjection.nearestIndexByTime(trace, 0.0))
        assertEquals(1, TripReplayChartsProjection.nearestIndexByTime(trace, 1.4))
        assertEquals(2, TripReplayChartsProjection.nearestIndexByTime(trace, 2.9))
        // Before the first / after the last clamp to the ends.
        assertEquals(0, TripReplayChartsProjection.nearestIndexByTime(trace, -10.0))
        assertEquals(2, TripReplayChartsProjection.nearestIndexByTime(trace, 99.0))
    }

    @Test
    fun nearestIndexByTimeBreaksExactTiesToTheUpperIndex() {
        val twoPoint =
            listOf(
                TripReplayChartPoint(index = 0, time = 0.0, speed = 0.0, power = 0.0),
                TripReplayChartPoint(index = 1, time = 10.0, speed = 0.0, power = 0.0),
            )
        // Exactly halfway (5.0): the web guard is strict (`<`), so a tie does NOT pick the lower index — it
        // falls through to `return lo` (the upper index). Ported verbatim, the native search must agree.
        assertEquals(1, TripReplayChartsProjection.nearestIndexByTime(twoPoint, 5.0))
        // A hair below the midpoint, the lower index is strictly closer.
        assertEquals(0, TripReplayChartsProjection.nearestIndexByTime(twoPoint, 4.9))
    }

    @Test
    fun nearestIndexByTimeHandlesEmptyAndSingleton() {
        assertEquals(0, TripReplayChartsProjection.nearestIndexByTime(emptyList(), 3.0))
        assertEquals(0, TripReplayChartsProjection.nearestIndexByTime(listOf(trace.first()), 99.0))
    }

    // ── fmt / safeNumber helpers (web charts fmt parity) ───────────────────────────

    @Test
    fun numberGroupsThousandsAtRequestedPrecisionAndCoercesNonFinite() {
        assertEquals("80", TripReplayChartFormat.number(80.0, 0, Locale.US))
        assertEquals("1,234.5", TripReplayChartFormat.number(1234.5, 1, Locale.US))
        // safeNumber: non-finite ⇒ 0.
        assertEquals("0.0", TripReplayChartFormat.number(Double.NaN, 1, Locale.US))
        assertEquals("0", TripReplayChartFormat.number(Double.POSITIVE_INFINITY, 0, Locale.US))
    }

    @Test
    fun axisAndCursorLabelsCarryTheWebSuffixes() {
        assertEquals("12m", TripReplayChartFormat.axisMinuteLabel(12.4, Locale.US))
        assertEquals("12.4 min", TripReplayChartFormat.cursorMinuteLabel(12.4, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTripReplayChartsOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TripReplayCharts"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("trip-replay-charts", TripReplayChartsRegistration.ID)
        assertEquals("TripReplayCharts", TripReplayChartsRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
