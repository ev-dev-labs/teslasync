package io.teslasync.android.featureviews.alertssection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Alerts weekly-digest section's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx): the
 * severity-counts → (slices, total, totalLabel, empty) projection with its preserved order, the capitalized
 * display name (web `severity.charAt(0).toUpperCase() + severity.slice(1)`), the grouped integer formatting
 * (web `fmtInt`), the severity classification (web `STATUS_COLORS` / `CHART_COLORS` key match), and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class AlertsSectionProjectionTest {
    private val counts =
        listOf(
            AlertSeverityCount(severity = "critical", count = 2),
            AlertSeverityCount(severity = "warning", count = 5),
            AlertSeverityCount(severity = "info", count = 3),
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsCountsPreservingOrderWithNamesLabelsKindsAndTotal() {
        val result = AlertsSectionProjection.project(counts, Locale.US)

        assertFalse(result.isEmpty)
        assertEquals(10L, result.total)
        assertEquals("10", result.totalLabel)
        assertEquals(listOf("critical", "warning", "info"), result.slices.map { it.severity })
        assertEquals(listOf("Critical", "Warning", "Info"), result.slices.map { it.displayName })
        assertEquals(listOf(2L, 5L, 3L), result.slices.map { it.count })
        assertEquals(listOf("2", "5", "3"), result.slices.map { it.countLabel })
        assertEquals(
            listOf(AlertSeverity.Critical, AlertSeverity.Warning, AlertSeverity.Info),
            result.slices.map { it.kind },
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoCounts() {
        val result = AlertsSectionProjection.project(emptyList(), Locale.US)

        assertTrue(result.isEmpty)
        assertEquals(0L, result.total)
        assertEquals("0", result.totalLabel)
        assertTrue(result.slices.isEmpty())
    }

    @Test
    fun projectTreatsAllZeroCountsAsEmptyLikeWebAlertTotalZero() {
        val result =
            AlertsSectionProjection.project(
                listOf(AlertSeverityCount("info", 0), AlertSeverityCount("warning", 0)),
                Locale.US,
            )

        assertTrue(result.isEmpty)
        assertEquals(0L, result.total)
    }

    @Test
    fun projectClassifiesUnknownSeverityAsOtherAndStillCapitalizes() {
        val result =
            AlertsSectionProjection.project(listOf(AlertSeverityCount("battery", 4)), Locale.US)

        assertEquals(1, result.slices.size)
        val slice = result.slices.single()
        assertEquals("Battery", slice.displayName)
        assertEquals(AlertSeverity.Other, slice.kind)
        assertEquals(4L, result.total)
    }

    // ── Count formatting (web fmtInt parity) ───────────────────────────────────────

    @Test
    fun formatCountGroupsThousandsAndHandlesZero() {
        assertEquals("0", AlertsSectionProjection.formatCount(0, Locale.US))
        assertEquals("1,204", AlertsSectionProjection.formatCount(1_204, Locale.US))
        assertEquals("1,000,000", AlertsSectionProjection.formatCount(1_000_000, Locale.US))
    }

    // ── Display name (web capitalize parity) ───────────────────────────────────────

    @Test
    fun capitalizeFirstUppercasesOnlyTheFirstCharacter() {
        assertEquals("Critical", AlertsSectionProjection.capitalizeFirst("critical"))
        assertEquals("Info", AlertsSectionProjection.capitalizeFirst("info"))
        // Already-uppercase input is left unchanged beyond the first char (web slice(1) keeps the rest).
        assertEquals("WARNING", AlertsSectionProjection.capitalizeFirst("WARNING"))
        assertEquals("", AlertsSectionProjection.capitalizeFirst(""))
    }

    // ── Severity classification (web key match) ────────────────────────────────────

    @Test
    fun severityFromMatchesKnownKeysCaseAndSpaceTolerantElseOther() {
        assertEquals(AlertSeverity.Critical, AlertSeverity.from("critical"))
        assertEquals(AlertSeverity.Warning, AlertSeverity.from("  WARNING "))
        assertEquals(AlertSeverity.Info, AlertSeverity.from("Info"))
        assertEquals(AlertSeverity.Other, AlertSeverity.from("offline"))
        assertEquals(AlertSeverity.Other, AlertSeverity.from(""))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAlertsSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AlertsSection"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("alerts-section", AlertsSectionRegistration.ID)
        assertEquals("AlertsSection", AlertsSectionRegistration.SLUG)
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
