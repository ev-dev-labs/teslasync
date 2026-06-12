package io.teslasync.android.featureviews.gforcepanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device unit tests for the pure GForcePanel data adapter + projection — the native port of everything the
 * web component (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx) derives before
 * returning JSX: the `typeof === 'number'` field guards, the `hasAny` / `magnitude` (`sqrt(lat² + lon²)`)
 * computation, the three-tile projection with the `fmtNumber(value, 2)` / em-dash formatting, the empty-state
 * classification, locale-aware grouping, the merged TalkBack label, and the PII-safe `view.opened` diagnostic.
 * Run by the offline `:android:testReleaseUnitTest` gate.
 */
class GForcePanelModelTest {
    private fun strings(): GForcePanelStrings =
        GForcePanelStrings(
            title = "Acceleration G-Force",
            lateral = "Lateral",
            longitudinal = "Longitudinal",
            combined = "Combined",
            noData = "No G-force telemetry received yet",
        )

    // ── parse: the web `typeof === 'number'` field guards ─────────────────────────
    @Test
    fun parseReadsNumericFields() {
        val reading =
            GForcePanelProjection.parse(
                buildJsonObject {
                    put("lateral_acceleration", 0.30)
                    put("longitudinal_acceleration", -0.20)
                },
            )
        assertEquals(0.30, reading.lateral!!, EPS)
        assertEquals(-0.20, reading.longitudinal!!, EPS)
    }

    @Test
    fun parseTreatsMissingFieldsAsNull() {
        val reading = GForcePanelProjection.parse(buildJsonObject { put("pedal_position", 42.0) })
        assertNull(reading.lateral)
        assertNull(reading.longitudinal)
    }

    @Test
    fun parseRejectsStringNumberLikeJsTypeofGuard() {
        // A quoted-string field is `typeof 'string'` in JS, so the web guard rejects it → null.
        val reading =
            GForcePanelProjection.parse(
                buildJsonObject {
                    put("lateral_acceleration", "0.35")
                    put("longitudinal_acceleration", 0.10)
                },
            )
        assertNull(reading.lateral)
        assertEquals(0.10, reading.longitudinal!!, EPS)
    }

    @Test
    fun parseOfNonObjectIsAllNull() {
        val reading = GForcePanelProjection.parse(JsonNull)
        assertNull(reading.lateral)
        assertNull(reading.longitudinal)
        assertFalse(reading.hasAny)
    }

    // ── hasAny / magnitude (web locals) ───────────────────────────────────────────
    @Test
    fun magnitudeIsRootSumSquareWhenBothPresent() {
        val reading = GForceReading(lateral = 0.30, longitudinal = 0.40)
        assertTrue(reading.hasAny)
        assertEquals(0.50, reading.magnitude!!, EPS)
    }

    @Test
    fun magnitudeIsNullWhenEitherReadingMissing() {
        assertNull(GForceReading(lateral = 0.30, longitudinal = null).magnitude)
        assertNull(GForceReading(lateral = null, longitudinal = 0.40).magnitude)
        assertNull(GForceReading(lateral = null, longitudinal = null).magnitude)
    }

    // ── project: the three-tile render state ──────────────────────────────────────
    @Test
    fun projectBothPresentRendersThreeFormattedTiles() {
        val display =
            GForcePanelProjection.project(
                buildJsonObject {
                    put("lateral_acceleration", 0.30)
                    put("longitudinal_acceleration", 0.40)
                },
                strings(),
                Locale.US,
            )
        assertTrue(display.hasAny)
        assertEquals(listOf(GForceAxis.Lateral, GForceAxis.Longitudinal, GForceAxis.Combined), display.tiles.map { it.axis })
        assertEquals("0.30", display.tiles[0].value)
        assertEquals("0.40", display.tiles[1].value)
        assertEquals("0.50", display.tiles[2].value)
        assertEquals(G_FORCE_UNIT, display.unit)
    }

    @Test
    fun projectOnlyLateralShowsEmDashForLongitudinalAndCombined() {
        val display =
            GForcePanelProjection.project(
                buildJsonObject { put("lateral_acceleration", 0.12) },
                strings(),
                Locale.US,
            )
        assertTrue(display.hasAny)
        assertEquals("0.12", display.tiles[0].value)
        assertEquals(EM_DASH, display.tiles[1].value)
        assertEquals(EM_DASH, display.tiles[2].value)
    }

    @Test
    fun projectNoReadingsHasNoTiles() {
        val display = GForcePanelProjection.project(buildJsonObject {}, strings(), Locale.US)
        assertFalse(display.hasAny)
        assertTrue(display.tiles.isEmpty())
    }

    @Test
    fun projectUsesLocaleDecimalSeparator() {
        val display =
            GForcePanelProjection.project(
                buildJsonObject {
                    put("lateral_acceleration", 0.30)
                    put("longitudinal_acceleration", 0.40)
                },
                strings(),
                Locale.GERMANY,
            )
        assertEquals("0,30", display.tiles[0].value)
        assertEquals("0,50", display.tiles[2].value)
    }

    // ── empty classification (the view-model's UiPhase.Empty predicate) ────────────
    @Test
    fun isEmptySnapshotMatchesHasAny() {
        assertTrue(GForcePanelProjection.isEmptySnapshot(null))
        assertTrue(GForcePanelProjection.isEmptySnapshot(JsonNull))
        assertTrue(GForcePanelProjection.isEmptySnapshot(buildJsonObject {}))
        assertTrue(GForcePanelProjection.isEmptySnapshot(buildJsonObject { put("pedal_position", 1.0) }))
        assertFalse(GForcePanelProjection.isEmptySnapshot(buildJsonObject { put("lateral_acceleration", 0.1) }))
    }

    // ── accessibility (merged TalkBack label) ─────────────────────────────────────
    @Test
    fun tileAccessibilityLabelMergesLabelValueUnit() {
        val tile = GForceTile(GForceAxis.Lateral, "Lateral", "0.30")
        assertEquals("Lateral, 0.30 g", tile.accessibilityLabel(G_FORCE_UNIT))
    }

    // ── locale resolution ─────────────────────────────────────────────────────────
    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }

    // ── diagnostics (P1/S11 view.opened contract) ─────────────────────────────────
    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordGForcePanelOpened(logger)

        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "GForcePanel"), record.fields)
    }

    @Test
    fun slugIsTheStableSurfaceName() {
        assertEquals("GForcePanel", G_FORCE_PANEL_SLUG)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        private const val EPS: Double = 1e-9
    }
}
