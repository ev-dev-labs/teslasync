package io.teslasync.android.featureviews.socchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SOC-over-time chart's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/drive-detail/SocChart.tsx): the ordered
 * x-axis labels, the raw `battery` value column (the web `<Area dataKey="battery">` plots it unfiltered),
 * the `chartData.length > 1` content/empty boundary, the `<YAxis domain={[0, 100]}>` numeric tick
 * formatting, the `t(key, default)` resolve-or-fallback for the catalog-absent aria key, and the PII-safe
 * `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class SocChartProjectionTest {
    private val trace =
        listOf(
            SocChartPoint(time = "09:00", battery = 88.0),
            SocChartPoint(time = "09:05", battery = 86.0),
            SocChartPoint(time = "09:10", battery = 0.0),
        )

    // ── Projection: ordered labels + raw SOC column ───────────────────────────────

    @Test
    fun projectPreservesOrderAndPlotsRawBattery() {
        val result = SocChartProjection.project(trace)

        assertEquals(listOf("09:00", "09:05", "09:10"), result.xLabels)
        // The area plots the raw battery, including the non-positive sample (web dataKey="battery", no filter).
        assertEquals(listOf(88.0, 86.0, 0.0), result.socValues)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectOnEmptyInputYieldsEmptyColumnsAndEmptyFlag() {
        val result = SocChartProjection.project(emptyList())

        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.socValues.isEmpty())
        assertTrue(result.isEmpty)
    }

    // ── Projection: content/empty boundary (web chartData.length > 1) ──────────────

    @Test
    fun projectIsEmptyForZeroOrOneSampleAndContentForTwoPlus() {
        assertTrue(SocChartProjection.project(emptyList()).isEmpty)
        assertTrue(SocChartProjection.project(listOf(trace.first())).isEmpty)
        assertFalse(SocChartProjection.project(trace.take(2)).isEmpty)
        assertFalse(SocChartProjection.project(trace).isEmpty)
    }

    // ── Value-axis formatting (web YAxis numeric ticks) ────────────────────────────

    @Test
    fun formatAxisValueRendersWholePercentWithLocaleGrouping() {
        assertEquals("0", SocChartProjection.formatAxisValue(0.0, Locale.US))
        assertEquals("50", SocChartProjection.formatAxisValue(50.0, Locale.US))
        // Rounds to whole numbers like the web 0-100 axis ticks.
        assertEquals("83", SocChartProjection.formatAxisValue(82.6, Locale.US))
        assertEquals("100", SocChartProjection.formatAxisValue(100.0, Locale.US))
    }

    @Test
    fun formatAxisValueCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0", SocChartProjection.formatAxisValue(Double.NaN, Locale.US))
        assertEquals("0", SocChartProjection.formatAxisValue(Double.POSITIVE_INFINITY, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, SocChartDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(SocChartDefaults.ARIA_LABEL, resolveOptional({ null }, KEY_ARIA, SocChartDefaults.ARIA_LABEL))
        assertEquals(SocChartDefaults.ARIA_LABEL, resolveOptional({ "   " }, KEY_ARIA, SocChartDefaults.ARIA_LABEL))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordSocChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SocChart"), fields)
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
