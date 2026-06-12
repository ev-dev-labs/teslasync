// Off-device unit coverage for the OperationsSection feature view's pure model (P3 acceptance: adapter +
// per-state + a11y/diagnostics tests). Exercises the delivery success-rate derivation (the web
// `notifStats && total_sent > 0 ? sent / total_sent * 100 : 100`), the shared success/warning/danger bucket
// behind both the header badge and the gauge color, the grouped integer / percent / channels labels (web
// `fmtInt` / `fmtPercent` / `${enabled}/${total}`), the lifecycle classifier the composable switches on
// (per-state coverage), the tolerant absolute timestamp formatter (web `formatDateTime`), and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.operationssection

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

class OperationsSectionModelTest {
    private val zone: ZoneId = ZoneId.of("UTC")
    private val locale: Locale = Locale.US

    private fun stats(
        totalSent: Long = 200,
        sent: Long = 190,
        totalChannels: Long = 5,
        enabledChannels: Long = 4,
    ) = NotificationStats(
        totalSent = totalSent,
        sent = sent,
        failed = 10,
        pending = 0,
        totalChannels = totalChannels,
        enabledChannels = enabledChannels,
    )

    private val auditRow =
        AuditLogRow(
            id = 1,
            createdAt = "2026-06-11T12:05:00Z",
            action = "settings.update",
            resource = "settings/units",
            details = "km -> mi",
        )

    private val notifRow =
        NotificationLogRow(
            id = 1,
            status = "sent",
            title = "Charge complete",
            message = "Reached 80%",
            createdAt = "2026-06-11T12:00:00Z",
        )

    // ── Success-rate derivation (web `total_sent > 0 ? sent / total_sent * 100 : 100`) ───────────

    @Test
    fun successRateIsTheSentRatioAsAPercentage() {
        assertEquals(95.0, OperationsSectionProjection.successRate(stats(totalSent = 200, sent = 190)), 1e-9)
    }

    @Test
    fun successRateIsAFullHundredWhenNothingWasSent() {
        assertEquals(PERCENT_MAX, OperationsSectionProjection.successRate(stats(totalSent = 0, sent = 0)), 1e-9)
    }

    @Test
    fun successRateIsAFullHundredWhenStatsAreAbsent() {
        assertEquals(PERCENT_MAX, OperationsSectionProjection.successRate(null), 1e-9)
    }

    @Test
    fun successRateIsAFullHundredWhenEveryMessageSucceeded() {
        assertEquals(PERCENT_MAX, OperationsSectionProjection.successRate(stats(totalSent = 42, sent = 42)), 1e-9)
    }

    // ── Success level + badge variant (the shared web ternary) ───────────────────────────────────

    @Test
    fun ninetyFiveIsTheInclusiveFloorOfTheHealthyBand() {
        assertEquals(SuccessLevel.Good, OperationsSectionProjection.successLevel(SUCCESS_RATE_GOOD))
        assertEquals(SuccessLevel.Good, OperationsSectionProjection.successLevel(100.0))
    }

    @Test
    fun eightyIsTheInclusiveFloorOfTheWarningBand() {
        assertEquals(SuccessLevel.Fair, OperationsSectionProjection.successLevel(SUCCESS_RATE_FAIR))
        assertEquals(SuccessLevel.Fair, OperationsSectionProjection.successLevel(94.999))
    }

    @Test
    fun belowEightyIsTheFailingBand() {
        assertEquals(SuccessLevel.Poor, OperationsSectionProjection.successLevel(79.999))
        assertEquals(SuccessLevel.Poor, OperationsSectionProjection.successLevel(0.0))
    }

    @Test
    fun badgeVariantTracksTheSuccessLevel() {
        assertEquals(BadgeVariant.Success, OperationsSectionProjection.badgeVariant(SuccessLevel.Good))
        assertEquals(BadgeVariant.Warning, OperationsSectionProjection.badgeVariant(SuccessLevel.Fair))
        assertEquals(BadgeVariant.Danger, OperationsSectionProjection.badgeVariant(SuccessLevel.Poor))
    }

    // ── Grouped integer / percent / channels labels (web `fmtInt` / `fmtPercent`) ────────────────

    @Test
    fun formatIntGroupsThousandsForTheLocale() {
        assertEquals("1,284", OperationsSectionProjection.formatInt(1_284, locale))
        assertEquals("0", OperationsSectionProjection.formatInt(0, locale))
    }

    @Test
    fun formatPercentKeepsOneFractionDigitAndAppendsThePercentSign() {
        assertEquals("95.0%", OperationsSectionProjection.formatPercent(95.0, locale))
        // One-decimal rounding matches the web Intl formatter (avoids tie values whose nearest double
        // representation would round either way on both platforms).
        assertEquals("96.8%", OperationsSectionProjection.formatPercent(96.78, locale))
        assertEquals("96.7%", OperationsSectionProjection.formatPercent(96.74, locale))
    }

    @Test
    fun channelsLabelIsEnabledOverTotalUngrouped() {
        assertEquals("4/5", OperationsSectionProjection.channelsLabel(stats(enabledChannels = 4, totalChannels = 5)))
    }

    // ── Lifecycle classifier (per-state) ─────────────────────────────────────────────────────────

    @Test
    fun hasContentWhenStatsExistOrAnyAuditRowExists() {
        assertTrue(OperationsSectionProjection.hasContent(OperationsData(stats(), null, emptyList())))
        assertTrue(OperationsSectionProjection.hasContent(OperationsData(null, null, listOf(auditRow))))
        assertFalse(OperationsSectionProjection.hasContent(OperationsData(null, emptyList(), emptyList())))
    }

    @Test
    fun projectUiStateCoversContentLoadingAndEmpty() {
        val populated = OperationsData(stats(), listOf(notifRow), listOf(auditRow))
        assertEquals(UiPhase.Content, OperationsSectionProjection.projectUiState(populated, loading = false).phase)

        val nothing = OperationsData(stats = null, notificationLogs = null, auditLogs = emptyList())
        assertEquals(UiPhase.Loading, OperationsSectionProjection.projectUiState(nothing, loading = true).phase)
        assertEquals(UiPhase.Empty, OperationsSectionProjection.projectUiState(nothing, loading = false).phase)
    }

    @Test
    fun projectUiStateStaysContentEvenWhileLoadingWhenSomethingIsAlreadyShowable() {
        val populated = OperationsData(stats(), null, listOf(auditRow))
        val state = OperationsSectionProjection.projectUiState(populated, loading = true)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(populated, state.data)
    }

    // ── Absolute timestamp formatting (web `formatDateTime`) ─────────────────────────────────────

    @Test
    fun formatRendersAnAbsoluteLocalizedTimestamp() {
        val text = OperationsTimeFormatting.format(notifRow.createdAt, zone, locale)
        assertTrue(text.contains("2026"))
        assertTrue(text.contains("Jun"))
        assertTrue(text.contains("12:00"))
    }

    @Test
    fun formatAcceptsOffsetAndZonelessTimestamps() {
        assertFalse(OperationsTimeFormatting.format("2026-06-11T12:00:00+02:00", zone, locale) == EM_DASH)
        assertFalse(OperationsTimeFormatting.format("2026-06-11T12:00:00", zone, locale) == EM_DASH)
    }

    @Test
    fun formatFallsBackToTheEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, OperationsTimeFormatting.format("", zone, locale))
        assertEquals(EM_DASH, OperationsTimeFormatting.format("   ", zone, locale))
        assertEquals(EM_DASH, OperationsTimeFormatting.format("not-a-timestamp", zone, locale))
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordOperationsSectionOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "OperationsSection"), record.fields)
        assertEquals("OperationsSection", OperationsSectionRegistration.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
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
}
