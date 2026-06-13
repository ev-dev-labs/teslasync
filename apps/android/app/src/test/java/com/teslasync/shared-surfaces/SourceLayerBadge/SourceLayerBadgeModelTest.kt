// Off-device unit coverage for the SourceLayerBadge surface's pure model (P3 acceptance: adapter + per-state +
// a11y pieces). Exercises the prompt-mandated surface slug, the `source` → [SignalSourceLayer] parse (every
// layer + casing/whitespace tolerance + the null/unrecognised fallback), the glyph + tint mapping, the web
// `formatAge` cutoffs (ms / s / min / h / d, the `Math.round` minute bucket, the locale-stable `toFixed(1)`
// decimal forms), every [SourceLayerProjection] branch, and the PII-safe `view.opened` diagnostic. No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour
// the web `SourceLayerBadge` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sourcelayerbadge

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class SourceLayerBadgeModelTest {
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

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun diagnosticsSlugIsThePromptSurfaceSlug() {
        assertEquals("SourceLayerBadge", SourceLayerBadgeDiagnostics.SLUG)
    }

    // ── parse: every layer + casing/whitespace tolerance + unknown fallback ───────────

    @Test
    fun parseResolvesEveryKnownLayer() {
        assertEquals(SignalSourceLayer.L1, parseSourceLayer("l1"))
        assertEquals(SignalSourceLayer.L2, parseSourceLayer("l2"))
        assertEquals(SignalSourceLayer.Log, parseSourceLayer("log"))
        assertEquals(SignalSourceLayer.Stale, parseSourceLayer("stale"))
    }

    @Test
    fun parseToleratesBackendCasingAndWhitespace() {
        assertEquals(SignalSourceLayer.L1, parseSourceLayer("L1"))
        assertEquals(SignalSourceLayer.Stale, parseSourceLayer("  STALE  "))
        assertEquals(SignalSourceLayer.Log, parseSourceLayer("Log"))
    }

    @Test
    fun parseFallsBackToUnknownForNullOrUnrecognised() {
        assertEquals(SignalSourceLayer.Unknown, parseSourceLayer(null))
        assertEquals(SignalSourceLayer.Unknown, parseSourceLayer(""))
        assertEquals(SignalSourceLayer.Unknown, parseSourceLayer("l3"))
        assertEquals(SignalSourceLayer.Unknown, parseSourceLayer("redis"))
    }

    // ── glyph mapping (web style.label) ───────────────────────────────────────────────

    @Test
    fun glyphMatchesTheWebShortLabels() {
        assertEquals("L1", sourceLayerGlyph(SignalSourceLayer.L1))
        assertEquals("L2", sourceLayerGlyph(SignalSourceLayer.L2))
        assertEquals("LOG", sourceLayerGlyph(SignalSourceLayer.Log))
        assertEquals("STALE", sourceLayerGlyph(SignalSourceLayer.Stale))
        assertEquals("\u2014", sourceLayerGlyph(SignalSourceLayer.Unknown))
        assertEquals("\u2014", SOURCE_LAYER_UNKNOWN_GLYPH)
    }

    // ── tint mapping (web per-variant tints) ──────────────────────────────────────────

    @Test
    fun tintMatchesTheWebVariantColours() {
        assertEquals(SourceLayerTint.Success, sourceLayerTint(SignalSourceLayer.L1))
        assertEquals(SourceLayerTint.Info, sourceLayerTint(SignalSourceLayer.L2))
        assertEquals(SourceLayerTint.Warning, sourceLayerTint(SignalSourceLayer.Stale))
        assertEquals(SourceLayerTint.Muted, sourceLayerTint(SignalSourceLayer.Log))
        assertEquals(SourceLayerTint.Muted, sourceLayerTint(SignalSourceLayer.Unknown))
    }

    // ── formatAge: every web bucket + the null branch ─────────────────────────────────

    @Test
    fun formatAgeReturnsNullWhenAbsent() {
        assertNull(formatSourceAge(null))
    }

    @Test
    fun formatAgeRendersSubSecondAsWholeMilliseconds() {
        assertEquals("0 ms", formatSourceAge(0L))
        assertEquals("500 ms", formatSourceAge(500L))
        assertEquals("999 ms", formatSourceAge(999L))
    }

    @Test
    fun formatAgeRendersSecondsWithOneDecimal() {
        assertEquals("1.0 s", formatSourceAge(1_000L))
        assertEquals("1.5 s", formatSourceAge(1_500L))
        assertEquals("45.0 s", formatSourceAge(45_000L))
    }

    @Test
    fun formatAgeRendersMinutesRoundedHalfUp() {
        assertEquals("1 min", formatSourceAge(60_000L))
        assertEquals("2 min", formatSourceAge(90_000L))
        assertEquals("3 min", formatSourceAge(150_000L))
        assertEquals("3 min", formatSourceAge(200_000L))
    }

    @Test
    fun formatAgeRendersHoursWithOneDecimal() {
        assertEquals("1.0 h", formatSourceAge(3_600_000L))
        assertEquals("1.5 h", formatSourceAge(5_400_000L))
    }

    @Test
    fun formatAgeRendersDaysWithOneDecimal() {
        assertEquals("1.0 d", formatSourceAge(86_400_000L))
        assertEquals("1.5 d", formatSourceAge(129_600_000L))
    }

    @Test
    fun formatAgeDecimalSeparatorIsLocaleStable() {
        // The web `toFixed(1)` always uses a "." separator; a comma-decimal device locale must not drift it.
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.GERMANY)
            assertEquals("1.5 s", formatSourceAge(1_500L))
        } finally {
            Locale.setDefault(previous)
        }
    }

    // ── projection: every state branch ────────────────────────────────────────────────

    @Test
    fun projectionReducesAFreshL1WithAge() {
        val projection = projectSourceLayerBadge("l1", 850L)
        assertEquals(SignalSourceLayer.L1, projection.layer)
        assertEquals("L1", projection.glyph)
        assertEquals(SourceLayerTint.Success, projection.tint)
        assertEquals("850 ms", projection.ageText)
    }

    @Test
    fun projectionReducesAStaleLayerWithoutAge() {
        val projection = projectSourceLayerBadge("stale", null)
        assertEquals(SignalSourceLayer.Stale, projection.layer)
        assertEquals("STALE", projection.glyph)
        assertEquals(SourceLayerTint.Warning, projection.tint)
        assertNull(projection.ageText)
    }

    @Test
    fun projectionReducesTheUnknownEmptyBranch() {
        val projection = projectSourceLayerBadge(null, null)
        assertEquals(SignalSourceLayer.Unknown, projection.layer)
        assertEquals("\u2014", projection.glyph)
        assertEquals(SourceLayerTint.Muted, projection.tint)
        assertNull(projection.ageText)
    }

    @Test
    fun projectionReducesAReplayLogWithMinuteAge() {
        val projection = projectSourceLayerBadge("log", 200_000L)
        assertEquals(SignalSourceLayer.Log, projection.layer)
        assertEquals("LOG", projection.glyph)
        assertEquals(SourceLayerTint.Muted, projection.tint)
        assertEquals("3 min", projection.ageText)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        SourceLayerBadgeDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "SourceLayerBadge"), record.fields)
        assertTrue(record.fields.values.none { it.contains("l1") || it.contains("stale") })
    }
}
