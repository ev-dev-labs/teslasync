package io.teslasync.android.featureviews.xrayheader

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the XRayHeader's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/admin/components/ingest-xray/XRayHeader.tsx): the
 * window → human-label mapping (web `WINDOW_LABEL`), the locale-grouped integer formatting (web `fmtInt`),
 * the summary → three-card projection (order, values, the `?? 0` nullish fallback), the empty predicate,
 * and the PII-safe `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 */
class XRayHeaderProjectionTest {
    private val labels =
        XRayHeaderLabels(
            samplesLabel = "Total samples",
            samplesSublabel = "within selected window",
            fieldsLabel = "Distinct fields",
            fieldsSublabel = "unique signal names",
            windowLabel = "Window",
            windowSublabel = "observation horizon",
            windowValue = "1 hour",
        )

    // ── Window mapping (web IngestXRayWindow + WINDOW_LABEL) ──────────────────────

    @Test
    fun fromWireMapsEveryKnownWindowToken() {
        assertEquals(XRayWindow.M5, XRayWindow.fromWire("5m"))
        assertEquals(XRayWindow.M15, XRayWindow.fromWire("15m"))
        assertEquals(XRayWindow.H1, XRayWindow.fromWire("1h"))
        assertEquals(XRayWindow.H6, XRayWindow.fromWire("6h"))
        assertEquals(XRayWindow.H24, XRayWindow.fromWire("24h"))
    }

    @Test
    fun fromWireFoldsUnknownTokenToOneHourDefault() {
        assertEquals(XRayWindow.H1, XRayWindow.fromWire("90m"))
        assertEquals(XRayWindow.H1, XRayWindow.fromWire(""))
    }

    @Test
    fun defaultLabelsMatchTheWebWindowLabelConstant() {
        assertEquals("5 minutes", XRayWindow.M5.defaultLabel)
        assertEquals("15 minutes", XRayWindow.M15.defaultLabel)
        assertEquals("1 hour", XRayWindow.H1.defaultLabel)
        assertEquals("6 hours", XRayWindow.H6.defaultLabel)
        assertEquals("24 hours", XRayWindow.H24.defaultLabel)
    }

    // ── Integer formatting (web fmtInt) ──────────────────────────────────────────

    @Test
    fun formatIntGroupsThousandsForTheGivenLocale() {
        assertEquals("1,234,567", XRayHeaderProjection.formatInt(1_234_567L, Locale.US))
        assertEquals("0", XRayHeaderProjection.formatInt(0L, Locale.US))
        assertEquals("42", XRayHeaderProjection.formatInt(42L, Locale.US))
    }

    @Test
    fun formatIntHonoursLocaleSpecificGroupingSeparator() {
        // German groups with '.'; asserting the separator differs proves the formatter is locale-aware.
        assertEquals("1.234.567", XRayHeaderProjection.formatInt(1_234_567L, Locale.GERMANY))
    }

    // ── Projection (web <StatCard> trio) ─────────────────────────────────────────

    @Test
    fun projectMapsSummaryToThreeCardsInWebOrderWithFormattedValues() {
        val stats =
            XRayHeaderProjection.project(
                summary = IngestXRaySummary(totalSamples = 124_530, uniqueFields = 87),
                labels = labels,
                locale = Locale.US,
            )

        val ordered = stats.asList()
        assertEquals(3, ordered.size)

        assertEquals("Total samples", stats.samples.label)
        assertEquals("124,530", stats.samples.value)
        assertEquals("within selected window", stats.samples.sublabel)

        assertEquals("Distinct fields", stats.fields.label)
        assertEquals("87", stats.fields.value)
        assertEquals("unique signal names", stats.fields.sublabel)

        assertEquals("Window", stats.window.label)
        assertEquals("1 hour", stats.window.value)
        assertEquals("observation horizon", stats.window.sublabel)

        assertEquals(listOf(stats.samples, stats.fields, stats.window), ordered)
    }

    @Test
    fun projectFallsBackToZeroCountsForNullSummary() {
        val stats = XRayHeaderProjection.project(summary = null, labels = labels, locale = Locale.US)

        assertEquals("0", stats.samples.value)
        assertEquals("0", stats.fields.value)
        // The window card is echoed back immediately and never depends on the summary.
        assertEquals("1 hour", stats.window.value)
    }

    @Test
    fun isEmptyTreatsNullAndZeroSampleCountsAsEmpty() {
        assertTrue(XRayHeaderProjection.isEmpty(null))
        assertTrue(XRayHeaderProjection.isEmpty(IngestXRaySummary(totalSamples = 0, uniqueFields = 0)))
        // Distinct fields without samples is still "no rows" — the web summary keys off total_samples.
        assertTrue(XRayHeaderProjection.isEmpty(IngestXRaySummary(totalSamples = 0, uniqueFields = 5)))
        assertFalse(XRayHeaderProjection.isEmpty(IngestXRaySummary(totalSamples = 1, uniqueFields = 1)))
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("xray-header", XRayHeaderRegistration.ID)
        assertEquals("XRayHeader", XRayHeaderRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        recordXRayHeaderOpened(logger)

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "XRayHeader"), opened.single().second)
    }

    @Test
    fun diagnosticCarriesNoSampleCountOrVehicleFields() {
        val logger = RecordingLogger()

        recordXRayHeaderOpened(logger)

        val fields = logger.events.single().second
        assertEquals(setOf("surface"), fields.keys)
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
