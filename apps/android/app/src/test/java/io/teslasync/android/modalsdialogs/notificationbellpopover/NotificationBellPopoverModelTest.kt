// Off-device unit coverage for the NotificationBellPopover modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the badge "99+" cap, the `log.title || rule?.name || untitled` title
// fallback, the `rule?.severity ?? 'info'` severity collapse, the `display_name || #id` vehicle label, the
// log↔rule↔vehicle join the web `ruleMap` / `vehicleMap` perform, the tolerant `created_at` parse, the
// `formatRelative` bucketing (just now / Xm / Xh / Xd / absolute), the registry identifiers, and the PII-safe
// `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.notificationbellpopover

import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NotificationBellPopoverModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    private val now: Instant = Instant.parse("2026-06-12T12:00:00Z")

    private fun log(
        id: Long = 1,
        alertId: Long? = null,
        title: String = "",
        message: String = "",
        createdAt: String = "2026-06-12T11:59:30Z",
    ): NotificationLog = NotificationLog(id = id, alertId = alertId, title = title, message = message, createdAt = createdAt)

    private fun rule(
        id: Long = 7,
        name: String = "Battery rule",
        severity: String = "warn",
        vehicleId: Long? = null,
    ): AlertRule = AlertRule(id = id, name = name, severity = severity, vehicleId = vehicleId, signalName = "BatteryLevel")

    private fun vehicle(
        id: Long = 2,
        displayName: String = "Model 3",
    ): Vehicle =
        Vehicle(
            createdAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            displayName = displayName,
            enrolledAt = kotlin.time.Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = kotlin.time.Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )

    // ── Badge: web `count > 99 ? '99+' : String(count)` ───────────────────────────────────────────

    @Test
    fun formatBadgeCount_capsAtNinetyNinePlus() {
        assertEquals("0", NotificationBellPopoverProjection.formatBadgeCount(0))
        assertEquals("7", NotificationBellPopoverProjection.formatBadgeCount(7))
        assertEquals("99", NotificationBellPopoverProjection.formatBadgeCount(99))
        assertEquals("99+", NotificationBellPopoverProjection.formatBadgeCount(100))
        assertEquals("99+", NotificationBellPopoverProjection.formatBadgeCount(4321))
    }

    // ── Title fallback: web `log.title || rule?.name || t('untitled')` ────────────────────────────

    @Test
    fun pickTitle_prefersLogTitleThenRuleNameThenNull() {
        assertEquals("Battery low", NotificationBellPopoverProjection.pickTitle("Battery low", "Rule name"))
        assertEquals("Rule name", NotificationBellPopoverProjection.pickTitle("   ", "Rule name"))
        assertEquals("Rule name", NotificationBellPopoverProjection.pickTitle("", "Rule name"))
        assertNull(NotificationBellPopoverProjection.pickTitle("", "   "))
        assertNull(NotificationBellPopoverProjection.pickTitle("", null))
    }

    // ── Severity: web `rule?.severity ?? 'info'`, collapsed onto info/warn/critical ───────────────

    @Test
    fun bellSeverityOf_collapsesWireSeverityOntoInfoWarnCritical() {
        assertEquals(Severity.Info, NotificationBellPopoverProjection.bellSeverityOf(null))
        assertEquals(Severity.Info, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "info")))
        assertEquals(Severity.Warn, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "warn")))
        assertEquals(Severity.Warn, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "warning")))
        assertEquals(Severity.Critical, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "critical")))
        assertEquals(Severity.Critical, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "error")))
        // Success / ok / unknown all collapse to info (the web returns 'info' for anything but warn/critical).
        assertEquals(Severity.Info, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "success")))
        assertEquals(Severity.Info, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "ok")))
        assertEquals(Severity.Info, NotificationBellPopoverProjection.bellSeverityOf(rule(severity = "weird")))
    }

    // ── Vehicle label: web `vehicle.display_name || #${vehicle.id}` ───────────────────────────────

    @Test
    fun vehicleLabel_usesDisplayNameThenHashIdThenNull() {
        assertEquals("Model 3", NotificationBellPopoverProjection.vehicleLabel(vehicle(displayName = "Model 3")))
        assertEquals("#2", NotificationBellPopoverProjection.vehicleLabel(vehicle(id = 2, displayName = "  ")))
        assertNull(NotificationBellPopoverProjection.vehicleLabel(null))
    }

    // ── Row join: web `ruleMap[log.alert_id]` + `vehicleMap[rule.vehicle_id]` ──────────────────────

    @Test
    fun projectRows_joinsRuleAndVehicleAndPreservesOrder() {
        val logs =
            listOf(
                log(id = 3, alertId = 7, title = "Battery low — Model Y", message = "Below 20%."),
                log(id = 2, alertId = 99, title = ""),
                log(id = 1, alertId = null, title = "Software update"),
            )
        val rules =
            listOf(
                rule(id = 7, name = "Low battery", severity = "critical", vehicleId = 2),
                rule(id = 99, name = "Charge complete", severity = "info", vehicleId = 404),
            )
        val rows = NotificationBellPopoverProjection.projectRows(logs, rules, listOf(vehicle(id = 2, displayName = "Model Y")))

        assertEquals(listOf(3L, 2L, 1L), rows.map { it.id })

        val joined = rows[0]
        assertEquals("Battery low — Model Y", joined.title)
        assertEquals("Below 20%.", joined.message)
        assertEquals(Severity.Critical, joined.severity)
        assertEquals("Model Y", joined.vehicleLabel)

        // alert_id matches a rule but the rule's vehicle is not enrolled → no vehicle label; title falls to rule name.
        val noVehicle = rows[1]
        assertEquals("Charge complete", noVehicle.title)
        assertNull(noVehicle.vehicleLabel)
        assertNull(noVehicle.message)

        // No alert_id → no rule → info severity, no vehicle, title straight from the log.
        val standalone = rows[2]
        assertEquals("Software update", standalone.title)
        assertEquals(Severity.Info, standalone.severity)
        assertNull(standalone.vehicleLabel)
    }

    // ── Tolerant timestamp parse (RFC-3339 / offset / zoneless / garbage) ─────────────────────────

    @Test
    fun parseTimestamp_decodesTolerantlyAndRejectsGarbage() {
        assertEquals(Instant.parse("2026-06-12T11:00:00Z"), NotificationBellPopoverProjection.parseTimestamp("2026-06-12T11:00:00Z"))
        assertEquals(Instant.parse("2026-06-12T11:00:00Z"), NotificationBellPopoverProjection.parseTimestamp("2026-06-12T13:00:00+02:00"))
        assertEquals(Instant.parse("2026-06-12T11:00:00Z"), NotificationBellPopoverProjection.parseTimestamp("2026-06-12T11:00:00"))
        assertNull(NotificationBellPopoverProjection.parseTimestamp(""))
        assertNull(NotificationBellPopoverProjection.parseTimestamp("not-a-date"))
    }

    // ── Relative bucketing: web `formatRelative` cutoffs ──────────────────────────────────────────

    @Test
    fun relativeTime_bucketsExactlyLikeFormatRelative() {
        assertEquals(BellRelativeTime.Absent, NotificationBellPopoverProjection.relativeTime(null, now))
        assertEquals(BellRelativeTime.JustNow, NotificationBellPopoverProjection.relativeTime(now.minusSeconds(30), now))
        assertEquals(BellRelativeTime.JustNow, NotificationBellPopoverProjection.relativeTime(now.minusSeconds(59), now))
        assertEquals(BellRelativeTime.Minutes(1), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(60), now))
        assertEquals(BellRelativeTime.Minutes(5), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(5 * 60), now))
        assertEquals(BellRelativeTime.Hours(1), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(60 * 60), now))
        assertEquals(BellRelativeTime.Hours(23), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(23 * 3600), now))
        assertEquals(BellRelativeTime.Days(1), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(24 * 3600), now))
        assertEquals(BellRelativeTime.Days(6), NotificationBellPopoverProjection.relativeTime(now.minusSeconds(6 * 86400), now))
    }

    @Test
    fun relativeTime_fallsBackToAbsoluteAtAWeekAndTreatsFutureAsJustNow() {
        val old = now.minusSeconds(8L * 86400)
        assertEquals(BellRelativeTime.Absolute(old), NotificationBellPopoverProjection.relativeTime(old, now))
        // A future timestamp (clock skew) is < 60s old by the web's signed diff → just now, never negative.
        assertEquals(BellRelativeTime.JustNow, NotificationBellPopoverProjection.relativeTime(now.plusSeconds(120), now))
    }

    // ── Registry + diagnostics ────────────────────────────────────────────────────────────────────

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("notification-bell-popover", NotificationBellPopoverRegistration.ID)
        assertEquals("NotificationBellPopover", NotificationBellPopoverRegistration.SLUG)
        assertEquals(10, NotificationBellPopoverRegistration.PREVIEW_LIMIT)
        assertEquals(99, NotificationBellPopoverRegistration.MAX_BADGE_COUNT)
        assertEquals("/notifications/inbox", NotificationBellPopoverRegistration.INBOX_ROUTE)
    }

    @Test
    fun recordNotificationBellPopoverOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordNotificationBellPopoverOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "NotificationBellPopover"), fields)
        // The diagnostic must carry no notification content — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
