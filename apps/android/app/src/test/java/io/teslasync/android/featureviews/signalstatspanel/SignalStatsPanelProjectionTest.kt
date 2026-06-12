package io.teslasync.android.featureviews.signalstatspanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SignalStatsPanel's pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/telemetry/components/SignalStatsPanel.tsx): the `displayStats` memo (pass-through
 * vs one-row-per-selected-signal with gap-filling stand-in rows), the `signalIndex ?? position` color-index
 * resolution clamped at 0, the `isEmptyStat` predicate + `emptyCount` reduce, the `visibleStats` hide-empty filter, the
 * `fmtNumber` (min/max/avg, incl. the `—` non-finite blank) and `fmtInt` (count) formatters, and the PII-safe
 * `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate. Locale.US fixes the grouping/decimal separators
 * so the formatted-string assertions are deterministic.
 */
class SignalStatsPanelProjectionTest {
    private val us = Locale.US

    private val populated =
        listOf(
            SignalStat(signal = "VehicleSpeed", min = 0.0, max = 120.5, avg = 47.34, count = 1820),
            SignalStat(signal = "BatteryLevel", min = 18.0, max = 92.0, avg = 64.41, count = 1820),
        )

    // ── displayStats: pass-through vs selected-signal stand-in filling ────────────

    @Test
    fun displayStatsPassesStatsThroughWhenNoSelectionGiven() {
        val input = SignalStatsInput(stats = populated)

        assertEquals(populated, SignalStatsProjection.displayStats(input))
    }

    @Test
    fun displayStatsEmitsOneRowPerSelectedSignalFillingGapsWithStandInRows() {
        val input =
            SignalStatsInput(
                stats = populated,
                selectedSignals = listOf("BatteryLevel", "TpmsPressureFl", "VehicleSpeed"),
            )

        val rows = SignalStatsProjection.displayStats(input)

        // One row per selected signal, in the selection order (web `selectedSignals.map(...)`).
        assertEquals(listOf("BatteryLevel", "TpmsPressureFl", "VehicleSpeed"), rows.map { it.signal })
        // The gap signal becomes an empty stand-in row (web `emptyStatRow`).
        val gap = rows.single { it.signal == "TpmsPressureFl" }
        assertTrue(SignalStatsProjection.isEmptyStat(gap))
        assertEquals(0, gap.count)
        assertTrue(gap.min.isNaN())
    }

    @Test
    fun emptyStatRowHasNoSamples() {
        val row = SignalStatsProjection.emptyStatRow("X")
        assertEquals(0, row.count)
        assertTrue(row.min.isNaN())
        assertTrue(row.max.isNaN())
        assertTrue(row.avg.isNaN())
        assertTrue(SignalStatsProjection.isEmptyStat(row))
    }

    // ── project: color index + empty count ───────────────────────────────────────────

    @Test
    fun projectAssignsColorIndexByPositionWhenNoSignalIndexGiven() {
        val display = SignalStatsProjection.project(SignalStatsInput(stats = populated))

        assertEquals(listOf(0, 1), display.rows.map { it.colorIndex })
        assertEquals(0, display.emptyCount)
        assertFalse(display.isEmpty)
    }

    @Test
    fun projectPrefersSignalIndexAndClampsNegativeToZero() {
        val input =
            SignalStatsInput(
                stats = populated,
                signalIndex = mapOf("VehicleSpeed" to 5, "BatteryLevel" to -3),
            )

        val byName = SignalStatsProjection.project(input).rows.associateBy { it.signal }

        assertEquals(5, byName.getValue("VehicleSpeed").colorIndex) // web `signalIndex[signal]`
        assertEquals(0, byName.getValue("BatteryLevel").colorIndex) // web `Math.max(0, idx)`
    }

    @Test
    fun projectCountsEmptyRows() {
        val input =
            SignalStatsInput(
                stats = populated,
                selectedSignals = listOf("VehicleSpeed", "TpmsPressureFl", "TpmsPressureFr"),
            )

        val display = SignalStatsProjection.project(input)

        assertEquals(3, display.rows.size)
        assertEquals(2, display.emptyCount) // the two gap signals
    }

    // ── visibleRows: hide-empty filter (web `visibleStats`) ────────────────────────────

    @Test
    fun visibleRowsHidesEmptyRowsOnlyWhenHideEmptyIsTrue() {
        val input =
            SignalStatsInput(
                stats = populated,
                selectedSignals = listOf("VehicleSpeed", "TpmsPressureFl"),
            )
        val display = SignalStatsProjection.project(input)

        assertEquals(2, display.visibleRows(hideEmpty = false).size)
        val visible = display.visibleRows(hideEmpty = true)
        assertEquals(listOf("VehicleSpeed"), visible.map { it.signal })
    }

    // ── formatters (web `fmtNumber` / `fmtInt`) ─────────────────────────────────────────

    @Test
    fun formatStatRendersFiniteValuesAtTwoDecimals() {
        assertEquals("47.34", SignalStatsProjection.formatStat(47.34, locale = us))
        assertEquals("120.50", SignalStatsProjection.formatStat(120.5, locale = us))
        assertEquals("0.00", SignalStatsProjection.formatStat(0.0, locale = us))
    }

    @Test
    fun formatStatRendersEmDashForNonFinite() {
        assertEquals(ChartFormat.EMPTY, SignalStatsProjection.formatStat(Double.NaN, locale = us))
        assertEquals(ChartFormat.EMPTY, SignalStatsProjection.formatStat(Double.POSITIVE_INFINITY, locale = us))
    }

    @Test
    fun formatCountUsesGroupingAndNoDecimals() {
        assertEquals("1,820", SignalStatsProjection.formatCount(1820, locale = us))
        assertEquals("0", SignalStatsProjection.formatCount(0, locale = us))
    }

    // ── diagnostics (P1/S11 view.opened contract) ──────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        SignalStatsPanelDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SignalStatsPanel"), fields)
    }

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
