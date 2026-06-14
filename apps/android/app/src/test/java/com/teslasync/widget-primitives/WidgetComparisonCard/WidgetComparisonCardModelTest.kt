// Off-device unit coverage for the WidgetComparisonCard primitive's pure model (P3 acceptance: adapter +
// per-state + diagnostics pieces). Exercises the registration slug the prompt mandates, the compact slice
// (web `metrics.slice(0, 2)`), both projection branches (empty / rows), the `higherIsBetter → direction`
// mapping and the inline `{ direction }` semantic the embedded delta receives, the row passthrough, and the
// PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the behaviour the web `WidgetComparisonCard` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetcomparisoncard

import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetComparisonCardModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun metric(
        label: String,
        formatted: String = "10",
        unit: String? = null,
        higherIsBetter: Boolean = true,
    ): ComparisonMetric =
        ComparisonMetric(
            label = label,
            current = 10.0,
            previous = 8.0,
            formattedCurrent = formatted,
            unit = unit,
            higherIsBetter = higherIsBetter,
        )

    private fun rowsOf(input: WidgetComparisonCardInput): List<ComparisonRow> =
        (WidgetComparisonCardProjection.project(input) as WidgetComparisonCardProjection.Rows).rows

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("widget-comparison-card", WidgetComparisonCardRegistration.ID)
        assertEquals("WidgetComparisonCard", WidgetComparisonCardRegistration.SLUG)
    }

    // ── projection: empty branch (web visible.length === 0) ───────────────────────────

    @Test
    fun emptyMetricsProjectsTheEmptyBranch() {
        val projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(emptyList()))
        assertEquals(WidgetComparisonCardProjection.Empty, projection)
    }

    @Test
    fun compactEmptyMetricsStillProjectsTheEmptyBranch() {
        val projection = WidgetComparisonCardProjection.project(WidgetComparisonCardInput(emptyList(), compact = true))
        assertEquals(WidgetComparisonCardProjection.Empty, projection)
    }

    // ── projection: rows branch + compact slice (web metrics.slice(0, 2)) ─────────────

    @Test
    fun nonEmptyMetricsProjectAllRowsInOrder() {
        val metrics = listOf(metric("A"), metric("B"), metric("C"))
        val rows = rowsOf(WidgetComparisonCardInput(metrics))
        assertEquals(listOf("A", "B", "C"), rows.map { it.label })
    }

    @Test
    fun compactKeepsOnlyTheFirstTwoMetrics() {
        val metrics = listOf(metric("A"), metric("B"), metric("C"), metric("D"))
        val rows = rowsOf(WidgetComparisonCardInput(metrics, compact = true))
        assertEquals(listOf("A", "B"), rows.map { it.label })
    }

    @Test
    fun compactWithFewerThanLimitKeepsAll() {
        val metrics = listOf(metric("A"))
        val rows = rowsOf(WidgetComparisonCardInput(metrics, compact = true))
        assertEquals(listOf("A"), rows.map { it.label })
    }

    // ── ComparisonMetric → direction + semantic (web higherIsBetter / inline {direction}) ──

    @Test
    fun higherIsBetterMapsToHigherBetterDirection() {
        assertEquals(Direction.HigherBetter, metric("range", higherIsBetter = true).direction)
    }

    @Test
    fun lowerIsBetterMapsToLowerBetterDirection() {
        assertEquals(Direction.LowerBetter, metric("cost", higherIsBetter = false).direction)
    }

    @Test
    fun higherIsBetterDefaultsToTrue() {
        // web `higherIsBetter ?? true`
        assertEquals(Direction.HigherBetter, ComparisonMetric("x", 1.0, 1.0, "1").direction)
    }

    @Test
    fun semanticCarriesDirectionAndNoUnitForPercentDelta() {
        val semantic = metric("Efficiency", higherIsBetter = false).semantic
        assertEquals(Direction.LowerBetter, semantic.direction)
        // web inline `{ direction }` supplies no unit; percent display ignores it.
        assertEquals(MetricUnit.Count, semantic.unit)
        assertEquals("Efficiency", semantic.id)
    }

    // ── ComparisonRow passthrough ─────────────────────────────────────────────────────

    @Test
    fun rowReducesEveryFieldFromTheMetric() {
        val source = ComparisonMetric(label = "Distance", current = 312.0, previous = 290.0, formattedCurrent = "312", unit = "mi")
        val row = ComparisonRow.from(source)
        assertEquals("Distance", row.label)
        assertEquals("312", row.formattedCurrent)
        assertEquals("mi", row.unit)
        assertEquals(312.0, row.current, 0.0)
        assertEquals(290.0, row.previous, 0.0)
        assertEquals(source.semantic, row.semantic)
    }

    @Test
    fun rowKeepsNullUnitWhenAbsent() {
        val row = ComparisonRow.from(metric("Trips", unit = null))
        assertEquals(null, row.unit)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        WidgetComparisonCardDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "WidgetComparisonCard"), record.fields)
    }

    @Test
    fun viewOpenedDiagnosticNeverLeaksMetricContent() {
        val logger = RecordingLogger()
        WidgetComparisonCardDiagnostics.recordViewOpened(logger)
        val leaked = logger.records.flatMap { it.fields.values }.any { it.contains("mi") || it.contains("Wh") || it.contains("$") }
        assertFalse(leaked)
        assertTrue(logger.records.isNotEmpty())
    }
}
