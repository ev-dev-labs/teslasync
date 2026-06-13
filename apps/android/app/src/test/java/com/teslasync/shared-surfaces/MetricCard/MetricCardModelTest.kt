// Off-device unit coverage for the MetricCard surface's pure model (P3 acceptance: adapter + per-state +
// a11y/diagnostics pieces). Exercises the registration slug the prompt mandates, the `value: string |
// number` parity (the `String(number)` display + the `Number(string)` numeric derivation), every
// [MetricCardProjection] footer branch (none / legacy change pill / delta, with the web `change && !delta`
// precedence and the `deltaCurrent = delta.current ?? finite(value)` derivation), the passthrough of
// label / value / subtitle / help / accent, and the PII-safe `view.opened` diagnostic. No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings +
// behaviour the web `MetricCard` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.metriccard

import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MetricCardModelTest {
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

    private val range = MetricSemantic("range", Direction.HigherBetter, MetricUnit.Distance)

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("metric-card", MetricCardRegistration.ID)
        assertEquals("MetricCard", MetricCardRegistration.SLUG)
    }

    // ── value: string | number → display text (web String(number)) ───────────────────

    @Test
    fun numericValueRendersWithStringNumberSemantics() {
        assertEquals("128", MetricCardValue.Numeric(128.0).displayText())
        assertEquals("0", MetricCardValue.Numeric(0.0).displayText())
        assertEquals("-7", MetricCardValue.Numeric(-7.0).displayText())
        assertEquals("42.5", MetricCardValue.Numeric(42.5).displayText())
        assertEquals("NaN", MetricCardValue.Numeric(Double.NaN).displayText())
        assertEquals("Infinity", MetricCardValue.Numeric(Double.POSITIVE_INFINITY).displayText())
        assertEquals("-Infinity", MetricCardValue.Numeric(Double.NEGATIVE_INFINITY).displayText())
    }

    @Test
    fun textValueRendersVerbatim() {
        assertEquals("142 kW", MetricCardValue.Text("142 kW").displayText())
        assertEquals("—", MetricCardValue.Text("—").displayText())
    }

    // ── value → numeric derivation (web Number(string) + isFinite) ────────────────────

    @Test
    fun numericValueDerivesItselfWhenFinite() {
        assertEquals(128.0, MetricCardValue.Numeric(128.0).numericOrNull()!!, 0.0)
        assertNull(MetricCardValue.Numeric(Double.NaN).numericOrNull())
        assertNull(MetricCardValue.Numeric(Double.POSITIVE_INFINITY).numericOrNull())
    }

    @Test
    fun textValueParsesWithNumberStringSemantics() {
        assertEquals(42.5, MetricCardValue.Text("42.5").numericOrNull()!!, 0.0)
        assertEquals(12.0, MetricCardValue.Text("  12 ").numericOrNull()!!, 0.0)
        // web Number("") === 0
        assertEquals(0.0, MetricCardValue.Text("   ").numericOrNull()!!, 0.0)
        // web Number("248 Wh/mi") === NaN → dropped
        assertNull(MetricCardValue.Text("248 Wh/mi").numericOrNull())
        assertNull(MetricCardValue.Text("abc").numericOrNull())
        // web isFinite(Number("Infinity")) === false → dropped
        assertNull(MetricCardValue.Text("Infinity").numericOrNull())
    }

    // ── projection: footer branches ──────────────────────────────────────────────────

    @Test
    fun basicCardHasNoFooter() {
        val projection = MetricCardProjection.project(MetricCardInput("Trips", MetricCardValue.Numeric(128.0)))
        assertEquals(MetricCardFooter.None, projection.footer)
        assertEquals("128", projection.displayValue)
        assertEquals(MetricCardAccent.Cyan, projection.accent)
    }

    @Test
    fun changeWithoutDeltaProjectsChangePill() {
        val projection =
            MetricCardProjection.project(
                MetricCardInput(
                    label = "Efficiency",
                    value = MetricCardValue.Text("248 Wh/mi"),
                    change = MetricCardChange(value = "4.2%", positive = true),
                ),
            )
        assertEquals(MetricCardFooter.ChangePill("4.2%", true), projection.footer)
    }

    @Test
    fun deltaDerivesItsCurrentFromTheCardValue() {
        val spec = MetricCardDeltaSpec(previous = 100.0, metric = range)
        val projection =
            MetricCardProjection.project(MetricCardInput("Range", MetricCardValue.Numeric(120.0), delta = spec))
        val footer = projection.footer as MetricCardFooter.DeltaFooter
        assertEquals(spec, footer.spec)
        assertEquals(120.0, footer.current!!, 0.0)
    }

    @Test
    fun deltaWinsOverTheLegacyChangePill() {
        val spec = MetricCardDeltaSpec(previous = 100.0, metric = range)
        val projection =
            MetricCardProjection.project(
                MetricCardInput(
                    label = "Range",
                    value = MetricCardValue.Numeric(120.0),
                    change = MetricCardChange(value = "ignored", positive = true),
                    delta = spec,
                ),
            )
        assertTrue(projection.footer is MetricCardFooter.DeltaFooter)
    }

    @Test
    fun deltaCurrentOverrideWinsOverTheCardValue() {
        val spec = MetricCardDeltaSpec(previous = 100.0, metric = range, currentOverride = 999.0)
        val projection =
            MetricCardProjection.project(MetricCardInput("Range", MetricCardValue.Numeric(120.0), delta = spec))
        val footer = projection.footer as MetricCardFooter.DeltaFooter
        assertEquals(999.0, footer.current!!, 0.0)
    }

    @Test
    fun deltaCurrentIsNullWhenValueIsNonNumericAndNoOverride() {
        val spec = MetricCardDeltaSpec(previous = 100.0, metric = range)
        val projection =
            MetricCardProjection.project(MetricCardInput("Range", MetricCardValue.Text("n/a"), delta = spec))
        val footer = projection.footer as MetricCardFooter.DeltaFooter
        assertNull(footer.current)
    }

    // ── projection: presentational passthrough ────────────────────────────────────────

    @Test
    fun projectionPassesThroughLabelValueSubtitleHelpAndAccent() {
        val help = MetricCardHelp(helpText = "Energy used per mile.")
        val projection =
            MetricCardProjection.project(
                MetricCardInput(
                    label = "Avg Power",
                    value = MetricCardValue.Text("142 kW"),
                    accent = MetricCardAccent.Purple,
                    subtitle = "last 30 days",
                    help = help,
                ),
            )
        assertEquals("Avg Power", projection.label)
        assertEquals("142 kW", projection.displayValue)
        assertEquals("last 30 days", projection.subtitle)
        assertEquals(help, projection.help)
        assertEquals(MetricCardAccent.Purple, projection.accent)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        MetricCardDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "MetricCard"), record.fields)
        assertTrue(record.fields.values.none { it.contains("kW") })
    }
}
