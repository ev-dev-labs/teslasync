package io.teslasync.android.featureviews.notificationrow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the NotificationRow's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/notifications/components/NotificationRow.tsx): the read /
 * archived guards (web `Boolean(log.read_at)` / `Boolean(log.archived_at)`), the badge-severity fallback (web
 * `rule?.severity ?? 'info'`), the vehicle label (web `display_name || #id`), the rule label, the timezone-mode
 * + display-zone resolution (web `vehicle ? 'vehicle' : 'user'` `<DateTime>`), the drill-through guard (web
 * `rule ? href : null`), and the tolerant timestamp parse + absolute format. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class NotificationRowProjectionTest {
    private fun baseLog(): NotificationLog =
        NotificationLog(
            id = 1,
            title = "Battery low",
            message = "State of charge dropped below 20%.",
            severity = "warning",
            createdAt = "2026-04-04T14:30:00Z",
        )

    private fun rule(
        severity: String = "critical",
        name: String = "Battery rule",
    ): AlertRule = AlertRule(id = 7, name = name, severity = severity, signalName = "BatteryLevel")

    private fun vehicle(
        timezone: String = "UTC",
        displayName: String = "Model 3",
    ): Vehicle =
        Vehicle(
            createdAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            displayName = displayName,
            enrolledAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            id = 2,
            teslaId = 1002,
            timezone = timezone,
            updatedAt = kotlin.time.Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN2",
        )

    // ── Presence guards (web Boolean(read_at) / Boolean(archived_at)) ─────────────

    @Test
    fun isPresentMatchesWebBooleanCoercion() {
        assertFalse(NotificationRowProjection.isPresent(null))
        assertFalse(NotificationRowProjection.isPresent(""))
        assertTrue(NotificationRowProjection.isPresent("2026-04-04T15:00:00Z"))
    }

    // ── Vehicle label (web vehicle.display_name || #id) ───────────────────────────

    @Test
    fun vehicleLabelUsesDisplayNameElseIdFallback() {
        assertNull(NotificationRowProjection.vehicleLabel(null))
        assertEquals("Model 3", NotificationRowProjection.vehicleLabel(vehicle(displayName = "Model 3")))
        assertEquals("#2", NotificationRowProjection.vehicleLabel(vehicle(displayName = "  ")))
    }

    // ── Display zone (web <DateTime in="vehicle">) ────────────────────────────────

    @Test
    fun resolveZonePrefersAValidVehicleTimezoneElseFallback() {
        val fallback = ZoneId.of("UTC")
        assertEquals(ZoneId.of("America/Los_Angeles"), NotificationRowProjection.resolveZone("America/Los_Angeles", fallback))
        assertEquals(fallback, NotificationRowProjection.resolveZone(null, fallback))
        assertEquals(fallback, NotificationRowProjection.resolveZone("   ", fallback))
        assertEquals(fallback, NotificationRowProjection.resolveZone("Not/AZone", fallback))
    }

    // ── Timestamp parse + format (web <DateTime>) ─────────────────────────────────

    @Test
    fun parseTimestampAcceptsInstantOffsetAndZonelessForms() {
        val expected = Instant.parse("2026-04-04T14:30:00Z")
        assertEquals(expected, NotificationRowProjection.parseTimestamp("2026-04-04T14:30:00Z"))
        assertEquals(expected, NotificationRowProjection.parseTimestamp("2026-04-04T14:30:00+00:00"))
        assertEquals(expected, NotificationRowProjection.parseTimestamp("2026-04-04T14:30:00"))
    }

    @Test
    fun parseTimestampReturnsNullForBlankOrUnparseable() {
        assertNull(NotificationRowProjection.parseTimestamp(""))
        assertNull(NotificationRowProjection.parseTimestamp("   "))
        assertNull(NotificationRowProjection.parseTimestamp("not-a-date"))
    }

    @Test
    fun formatTimestampRendersAbsoluteLocalizedTextInZone() {
        val instant = Instant.parse("2026-04-04T14:30:00Z")
        assertEquals("Apr 4, 14:30", NotificationRowProjection.formatTimestamp(instant, ZoneOffset.UTC, Locale.US))
        assertEquals("Apr 4, 07:30", NotificationRowProjection.formatTimestamp(instant, ZoneId.of("America/Los_Angeles"), Locale.US))
    }

    @Test
    fun formatTimestampRendersEmDashForNullInstant() {
        assertEquals(EM_DASH, NotificationRowProjection.formatTimestamp(null, ZoneOffset.UTC, Locale.US))
    }

    // ── Severity fallback (web rule?.severity ?? 'info') ──────────────────────────

    @Test
    fun severityFallsBackToInfoWithoutARuleElseUsesTheRuleSeverity() {
        assertEquals(DEFAULT_SEVERITY, NotificationRowProjection.project(NotificationRowInput(baseLog())).severity)
        val withRule = NotificationRowProjection.project(NotificationRowInput(baseLog(), rule(severity = "warning")))
        assertEquals("warning", withRule.severity)
    }

    // ── Message presence (web `{log.message && …}`) ───────────────────────────────

    @Test
    fun projectFoldsBlankMessageToNull() {
        assertNull(NotificationRowProjection.project(NotificationRowInput(baseLog().copy(message = "   "))).message)
        assertEquals(
            "State of charge dropped below 20%.",
            NotificationRowProjection.project(NotificationRowInput(baseLog())).message,
        )
    }

    // ── Full projection ───────────────────────────────────────────────────────────

    @Test
    fun projectMapsAnUnreadRowWithNoRuleOrVehicle() {
        val row = NotificationRowProjection.project(NotificationRowInput(baseLog()))

        assertEquals("Battery low", row.title)
        assertEquals(DEFAULT_SEVERITY, row.severity)
        assertFalse(row.isRead)
        assertFalse(row.isArchived)
        assertNull(row.vehicleLabel)
        assertNull(row.ruleName)
        assertNull(row.timezone)
        assertEquals(TzMode.User, row.tzMode)
        assertFalse(row.hasDrillthrough)
        assertEquals(Instant.parse("2026-04-04T14:30:00Z"), row.timestamp)
    }

    @Test
    fun projectMapsAReadArchivedRowWithRuleAndVehicle() {
        val log = baseLog().copy(readAt = "2026-04-04T15:00:00Z", archivedAt = "2026-04-04T15:05:00Z")
        val input = NotificationRowInput(log, rule(severity = "critical", name = "Battery rule"), vehicle(timezone = "America/Los_Angeles"))

        val row = NotificationRowProjection.project(input)

        assertTrue(row.isRead)
        assertTrue(row.isArchived)
        assertEquals("critical", row.severity)
        assertEquals("Battery rule", row.ruleName)
        assertEquals("Model 3", row.vehicleLabel)
        assertEquals("America/Los_Angeles", row.timezone)
        assertEquals(TzMode.Vehicle, row.tzMode)
        assertTrue(row.hasDrillthrough)
    }

    @Test
    fun projectLeavesTimestampNullForUnparseableCreatedAt() {
        assertNull(NotificationRowProjection.project(NotificationRowInput(baseLog().copy(createdAt = "bad"))).timestamp)
    }

    // ── Diagnostics (P1/S11 `view.opened`) + registry ────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordNotificationRowOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "NotificationRow"), record.fields)
    }

    @Test
    fun registrationSlugAndIdMatchTheSurfaceContract() {
        assertEquals("NotificationRow", NotificationRowRegistration.SLUG)
        assertEquals("notification-row", NotificationRowRegistration.ID)
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
