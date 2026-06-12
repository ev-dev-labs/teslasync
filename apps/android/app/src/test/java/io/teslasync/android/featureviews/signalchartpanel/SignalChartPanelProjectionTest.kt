package io.teslasync.android.featureviews.signalchartpanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SignalChartPanel's pure logic — the native analogue of the web component's
 * `useMemo` derivations (web/src/features/telemetry/components/SignalChartPanel.tsx): the dual-axis decision
 * (`useRightAxis`), the overlay/grid/auto mode resolution (`effectiveMode`), the per-signal series projection
 * (`<Line dataKey>` + `connectNulls`), the locale-grouped integer counters (`fmtInt`), the default time-axis
 * label, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class SignalChartPanelProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
    }

    // ── useRightAxis (web `useRightAxis` memo) ────────────────────────────────────

    @Test
    fun useRightAxisIsFalseWithFewerThanTwoStats() {
        assertFalse(SignalChartPanelProjection.useRightAxis(emptyList()))
        assertFalse(SignalChartPanelProjection.useRightAxis(listOf(stat("a", min = 0.0, max = 100.0))))
    }

    @Test
    fun useRightAxisIsTrueWhenRangesDifferByMoreThanTenTimes() {
        // range0 = 120, range1 = 5 → 120 / 5 = 24 > 10 → true (web dual-axis split).
        val stats = listOf(stat("speed", min = 0.0, max = 120.0), stat("power", min = 0.0, max = 5.0))
        assertTrue(SignalChartPanelProjection.useRightAxis(stats))
    }

    @Test
    fun useRightAxisIsTrueRegardlessOfWhichRangeIsLarger() {
        // range0 = 5, range1 = 120 → 120 / 5 = 24 > 10 → true (the `||` second branch).
        val stats = listOf(stat("power", min = 0.0, max = 5.0), stat("speed", min = 0.0, max = 120.0))
        assertTrue(SignalChartPanelProjection.useRightAxis(stats))
    }

    @Test
    fun useRightAxisIsFalseWhenRangesAreComparable() {
        // range0 = 120, range1 = 60 → ratio 2 ≤ 10 → false.
        val stats = listOf(stat("speed", min = 0.0, max = 120.0), stat("soc", min = 20.0, max = 80.0))
        assertFalse(SignalChartPanelProjection.useRightAxis(stats))
    }

    @Test
    fun useRightAxisTreatsAFlatSignalRangeAsOne() {
        // A flat first signal → range 1.0 (web `|max-min| || 1`); 100 / 1 = 100 > 10 → true.
        val stats = listOf(stat("gear", min = 4.0, max = 4.0), stat("speed", min = 0.0, max = 100.0))
        assertTrue(SignalChartPanelProjection.useRightAxis(stats))
        // Both flat → 1 / 1 = 1 ≤ 10 → false.
        val flatPair = listOf(stat("gear", min = 4.0, max = 4.0), stat("locked", min = 1.0, max = 1.0))
        assertFalse(SignalChartPanelProjection.useRightAxis(flatPair))
    }

    // ── effectiveMode (web `effectiveMode` memo) ──────────────────────────────────

    @Test
    fun effectiveModeOverlayAlwaysResolvesToOverlay() {
        assertEquals(
            ResolvedChartMode.Overlay,
            SignalChartPanelProjection.effectiveMode(SignalChartMode.Overlay, selectedSignalCount = 20, gridAutoThreshold = 8),
        )
    }

    @Test
    fun effectiveModeGridNeedsAtLeastTwoSignals() {
        assertEquals(
            ResolvedChartMode.Overlay,
            SignalChartPanelProjection.effectiveMode(SignalChartMode.Grid, selectedSignalCount = 1, gridAutoThreshold = 8),
        )
        assertEquals(
            ResolvedChartMode.Grid,
            SignalChartPanelProjection.effectiveMode(SignalChartMode.Grid, selectedSignalCount = 2, gridAutoThreshold = 8),
        )
    }

    @Test
    fun effectiveModeAutoFlipsOnlyAboveThreshold() {
        assertEquals(
            ResolvedChartMode.Overlay,
            SignalChartPanelProjection.effectiveMode(SignalChartMode.Auto, selectedSignalCount = 8, gridAutoThreshold = 8),
        )
        assertEquals(
            ResolvedChartMode.Grid,
            SignalChartPanelProjection.effectiveMode(SignalChartMode.Auto, selectedSignalCount = 9, gridAutoThreshold = 8),
        )
    }

    // ── seriesValues (web `<Line dataKey>` + connectNulls) ────────────────────────

    @Test
    fun seriesValuesProjectsRowsAndBridgesGaps() {
        val rows =
            listOf(
                row("t0", mapOf("a" to 1.0, "b" to 2.0)),
                row("t1", mapOf("a" to 3.0)),
            )
        assertEquals(listOf(1.0, 3.0), SignalChartPanelProjection.seriesValues(rows, "a"))
        // A row missing the signal contributes null so the line bridges the gap.
        assertEquals(listOf<Double?>(2.0, null), SignalChartPanelProjection.seriesValues(rows, "b"))
        // A signal absent from every row is all-null.
        assertEquals(listOf<Double?>(null, null), SignalChartPanelProjection.seriesValues(rows, "c"))
    }

    @Test
    fun seriesValuesDropsNonFiniteSamples() {
        val rows =
            listOf(
                row("t0", mapOf("a" to Double.NaN)),
                row("t1", mapOf("a" to Double.POSITIVE_INFINITY)),
                row("t2", mapOf("a" to 5.0)),
            )
        assertEquals(listOf<Double?>(null, null, 5.0), SignalChartPanelProjection.seriesValues(rows, "a"))
    }

    // ── project (web chart bindings) ──────────────────────────────────────────────

    @Test
    fun projectBuildsAxisLabelsSeriesAndDualAxisFlag() {
        val data =
            SignalChartData(
                selectedSignals = listOf("speed", "power"),
                rows =
                    listOf(
                        row("2026-06-12T10:00:00Z", mapOf("speed" to 10.0, "power" to 1.0)),
                        row("2026-06-12T10:00:01Z", mapOf("speed" to 20.0, "power" to 2.0)),
                    ),
                stats = listOf(stat("speed", 0.0, 120.0), stat("power", 0.0, 5.0)),
            )

        val result = SignalChartPanelProjection.project(data, SignalChartMode.Overlay, DEFAULT_GRID_AUTO_THRESHOLD)

        assertFalse(result.isEmpty)
        assertTrue(result.useRightAxis)
        assertEquals(listOf("2026-06-12T10:00:00Z", "2026-06-12T10:00:01Z"), result.xLabels)
        assertEquals(listOf("speed", "power"), result.series.map { it.signal })
        // The web `yAxisId={useRightAxis && i === 1 ? 'right' : 'left'}`: only the second series moves right.
        assertFalse(result.series[0].onRightAxis)
        assertTrue(result.series[1].onRightAxis)
        assertEquals(listOf(10.0, 20.0), result.series[0].values)
        assertEquals(ResolvedChartMode.Overlay, result.resolvedMode)
    }

    @Test
    fun projectReportsEmptyWhenNoRowsButStillBuildsSeriesShells() {
        val data = SignalChartData(selectedSignals = listOf("speed"), rows = emptyList(), stats = emptyList())

        val result = SignalChartPanelProjection.project(data, SignalChartMode.Auto, DEFAULT_GRID_AUTO_THRESHOLD)

        assertTrue(result.isEmpty)
        assertTrue(result.xLabels.isEmpty())
        assertEquals(1, result.series.size)
        val only = result.series.single()
        assertTrue(only.values.isEmpty())
        assertFalse(only.onRightAxis)
    }

    @Test
    fun projectResolvesAutoToGridWhenManySignalsArePinned() {
        val signals = (1..9).map { "sig$it" }
        val data =
            SignalChartData(
                selectedSignals = signals,
                rows = listOf(row("t0", signals.associateWith { 1.0 })),
                stats = emptyList(),
            )

        val result = SignalChartPanelProjection.project(data, SignalChartMode.Auto, DEFAULT_GRID_AUTO_THRESHOLD)

        assertEquals(ResolvedChartMode.Grid, result.resolvedMode)
        assertEquals(9, result.series.size)
    }

    // ── fmtInt (web `fmtInt` / `fmtNumber(v, 0)`) ─────────────────────────────────

    @Test
    fun fmtIntRendersLocaleGroupedIntegers() {
        assertEquals("0", SignalChartPanelProjection.fmtInt(0, Locale.US))
        assertEquals("42", SignalChartPanelProjection.fmtInt(42, Locale.US))
        assertEquals("1,234", SignalChartPanelProjection.fmtInt(1_234, Locale.US))
        assertEquals("4,096", SignalChartPanelProjection.fmtInt(4_096, Locale.US))
    }

    // ── defaultTimeLabel (web `useDateFormat().formatTime`) ───────────────────────

    @Test
    fun defaultTimeLabelFormatsAnIsoInstantAsTimeOfDay() {
        val label = SignalChartPanelProjection.defaultTimeLabel("2026-06-12T10:30:45Z")
        assertTrue("expected HH:mm:ss, got '$label'", Regex("""\d{2}:\d{2}:\d{2}""").matches(label))
    }

    @Test
    fun defaultTimeLabelFallsBackToRawTextWhenUnparseable() {
        assertEquals("not-a-timestamp", SignalChartPanelProjection.defaultTimeLabel("not-a-timestamp"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSignalChartPanelOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SignalChartPanel"), fields)
        // The slug carries no signal name or value.
        assertNull(fields["signal"])
    }

    private fun stat(
        signal: String,
        min: Double,
        max: Double,
        avg: Double = (min + max) / 2,
        count: Int = 1,
    ): SignalStat = SignalStat(signal = signal, min = min, max = max, avg = avg, count = count)

    private fun row(
        timestamp: String,
        values: Map<String, Double?>,
    ): SignalChartRow = SignalChartRow(timestamp = timestamp, values = values)

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
