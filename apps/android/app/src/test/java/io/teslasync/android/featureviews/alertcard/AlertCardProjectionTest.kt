package io.teslasync.android.featureviews.alertcard

import io.teslasync.shared.core.presentation.notifications.Alert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the AlertCard's pure logic — the native analogue of everything the web component
 * derives from its `alert` prop (web/src/features/notifications/components/AlertCard.tsx): the type → glyph
 * classification (web `TYPE_ICONS`), the relative-age bucket (web `getTimeAgo`), the humanized type label, the
 * acknowledged guard (web `Boolean(acknowledged_at)`) and its actor-vs-anonymous badge text, plus the full
 * projection field mapping. Runs in the :android:testReleaseUnitTest gate.
 */
class AlertCardProjectionTest {
    private val strings =
        AlertCardStrings(
            viewContext = "View context",
            unread = "Unread",
            auditTimeline = "Audit timeline",
            acknowledge = "Acknowledge",
            reopened = "Reopened",
            markRead = "Mark read",
            acknowledgedAnonymous = "Acknowledged",
            acknowledgedByActor = { actor -> "Acknowledged by $actor" },
        )

    private val now: Instant = Instant.parse("2026-04-04T15:00:00Z")

    private fun baseAlert(): Alert =
        Alert(
            id = 1,
            type = "low_battery",
            severity = "warning",
            title = "Battery low",
            message = "State of charge dropped below 20%.",
            isRead = false,
            createdAt = "2026-04-04T14:30:00Z",
        )

    // ── Glyph classification (web TYPE_ICONS) ─────────────────────────────────

    @Test
    fun fromTypeMapsEveryWebTypeIconKey() {
        assertEquals(AlertGlyph.Location, AlertGlyph.fromType("geofence_exit"))
        assertEquals(AlertGlyph.Location, AlertGlyph.fromType("geofence_enter"))
        assertEquals(AlertGlyph.Battery, AlertGlyph.fromType("low_battery"))
        assertEquals(AlertGlyph.Battery, AlertGlyph.fromType("battery_low"))
        assertEquals(AlertGlyph.Battery, AlertGlyph.fromType("battery_high"))
        assertEquals(AlertGlyph.Charging, AlertGlyph.fromType("charging_complete"))
        assertEquals(AlertGlyph.Charging, AlertGlyph.fromType("charging_cost"))
        assertEquals(AlertGlyph.Security, AlertGlyph.fromType("sentry_event"))
        assertEquals(AlertGlyph.Speed, AlertGlyph.fromType("speed_limit"))
        assertEquals(AlertGlyph.Climate, AlertGlyph.fromType("temperature"))
        assertEquals(AlertGlyph.SoftwareUpdate, AlertGlyph.fromType("software_update"))
        assertEquals(AlertGlyph.VampireDrain, AlertGlyph.fromType("vampire_drain"))
        assertEquals(AlertGlyph.TirePressure, AlertGlyph.fromType("tire_pressure_low"))
        assertEquals(AlertGlyph.Locked, AlertGlyph.fromType("idle_unlocked"))
        assertEquals(AlertGlyph.Analytics, AlertGlyph.fromType("efficiency_drop"))
        assertEquals(AlertGlyph.Database, AlertGlyph.fromType("system_database"))
        assertEquals(AlertGlyph.Mqtt, AlertGlyph.fromType("system_mqtt"))
        assertEquals(AlertGlyph.Storage, AlertGlyph.fromType("system_redis"))
        assertEquals(AlertGlyph.Radio, AlertGlyph.fromType("system_tesla_api"))
        assertEquals(AlertGlyph.Worker, AlertGlyph.fromType("system_worker"))
    }

    @Test
    fun fromTypeFoldsUnknownNullAndBlankToNotification() {
        assertEquals(AlertGlyph.Notification, AlertGlyph.fromType("brand_new_type"))
        assertEquals(AlertGlyph.Notification, AlertGlyph.fromType(null))
        assertEquals(AlertGlyph.Notification, AlertGlyph.fromType(""))
        assertEquals(AlertGlyph.Notification, AlertGlyph.fromType("   "))
    }

    @Test
    fun fromTypeIsCaseAndWhitespaceTolerant() {
        assertEquals(AlertGlyph.Security, AlertGlyph.fromType("  SENTRY_EVENT  "))
        assertEquals(AlertGlyph.Battery, AlertGlyph.fromType("Low_Battery"))
    }

    // ── Relative age (web getTimeAgo) ─────────────────────────────────────────

    @Test
    fun timeAgoBucketsMinutesUnderAnHour() {
        assertEquals(RelativeAge.Minutes(30), AlertCardProjection.timeAgo("2026-04-04T14:30:00Z", now))
        assertEquals(RelativeAge.Minutes(0), AlertCardProjection.timeAgo("2026-04-04T15:00:00Z", now))
        assertEquals(RelativeAge.Minutes(59), AlertCardProjection.timeAgo("2026-04-04T14:01:00Z", now))
    }

    @Test
    fun timeAgoBucketsHoursUnderADay() {
        assertEquals(RelativeAge.Hours(1), AlertCardProjection.timeAgo("2026-04-04T14:00:00Z", now))
        assertEquals(RelativeAge.Hours(3), AlertCardProjection.timeAgo("2026-04-04T12:00:00Z", now))
    }

    @Test
    fun timeAgoBucketsDaysFromADayOnward() {
        assertEquals(RelativeAge.Days(1), AlertCardProjection.timeAgo("2026-04-03T15:00:00Z", now))
        assertEquals(RelativeAge.Days(3), AlertCardProjection.timeAgo("2026-04-01T15:00:00Z", now))
    }

    @Test
    fun timeAgoClampsFutureTimestampsToZeroMinutes() {
        assertEquals(RelativeAge.Minutes(0), AlertCardProjection.timeAgo("2026-04-04T15:30:00Z", now))
    }

    @Test
    fun timeAgoReturnsNullForBlankOrUnparseableTimestamps() {
        assertNull(AlertCardProjection.timeAgo("", now))
        assertNull(AlertCardProjection.timeAgo("   ", now))
        assertNull(AlertCardProjection.timeAgo("not-a-date", now))
    }

    @Test
    fun timeAgoAcceptsOffsetAndZonelessTimestamps() {
        assertEquals(RelativeAge.Minutes(30), AlertCardProjection.timeAgo("2026-04-04T14:30:00+00:00", now))
        assertEquals(RelativeAge.Minutes(30), AlertCardProjection.timeAgo("2026-04-04T14:30:00", now))
    }

    // ── Type label (web (type ?? 'notification').replace(/_/g,' ')) ─────────────

    @Test
    fun typeLabelReplacesUnderscoresWithSpaces() {
        assertEquals("low battery", AlertCardProjection.typeLabel("low_battery"))
        assertEquals("system tesla api", AlertCardProjection.typeLabel("system_tesla_api"))
    }

    @Test
    fun typeLabelFallsBackToNotificationForNullOrBlank() {
        assertEquals(FALLBACK_TYPE, AlertCardProjection.typeLabel(null))
        assertEquals(FALLBACK_TYPE, AlertCardProjection.typeLabel(""))
        assertEquals(FALLBACK_TYPE, AlertCardProjection.typeLabel("   "))
    }

    // ── Acknowledged guard + badge (web Boolean(acknowledged_at) + ternary) ─────

    @Test
    fun isAcknowledgedMatchesWebBooleanCoercion() {
        assertFalse(AlertCardProjection.isAcknowledged(null))
        assertFalse(AlertCardProjection.isAcknowledged(""))
        assertTrue(AlertCardProjection.isAcknowledged("2026-04-04T15:05:00Z"))
    }

    @Test
    fun acknowledgedLabelIsNullWhenNotAcknowledged() {
        assertNull(AlertCardProjection.acknowledgedLabel(null, "Atul", strings))
        assertNull(AlertCardProjection.acknowledgedLabel("", "Atul", strings))
    }

    @Test
    fun acknowledgedLabelPicksInterpolatedActorWhenPresent() {
        assertEquals(
            "Acknowledged by Atul",
            AlertCardProjection.acknowledgedLabel("2026-04-04T15:05:00Z", "Atul", strings),
        )
    }

    @Test
    fun acknowledgedLabelPicksAnonymousWhenActorMissingOrBlank() {
        assertEquals("Acknowledged", AlertCardProjection.acknowledgedLabel("2026-04-04T15:05:00Z", null, strings))
        assertEquals("Acknowledged", AlertCardProjection.acknowledgedLabel("2026-04-04T15:05:00Z", "   ", strings))
    }

    // ── Full projection ───────────────────────────────────────────────────────

    @Test
    fun projectMapsEveryFieldForAnUnreadUnacknowledgedAlert() {
        val row = AlertCardProjection.project(baseAlert(), strings, now)

        assertEquals("Battery low", row.title)
        assertEquals("State of charge dropped below 20%.", row.message)
        assertEquals("warning", row.severity)
        assertEquals(AlertGlyph.Battery, row.glyph)
        assertEquals("low battery", row.typeLabel)
        assertFalse(row.isRead)
        assertFalse(row.isAcknowledged)
        assertNull(row.acknowledgedLabel)
        assertEquals(RelativeAge.Minutes(30), row.age)
    }

    @Test
    fun projectMapsAcknowledgedReadAlertWithActorBadge() {
        val row =
            AlertCardProjection.project(
                baseAlert().copy(
                    type = "sentry_event",
                    severity = "critical",
                    isRead = true,
                    createdAt = "2026-04-01T15:00:00Z",
                    acknowledgedAt = "2026-04-01T15:05:00Z",
                    acknowledgedBy = "Atul",
                ),
                strings,
                now,
            )

        assertTrue(row.isRead)
        assertTrue(row.isAcknowledged)
        assertEquals("Acknowledged by Atul", row.acknowledgedLabel)
        assertEquals(AlertGlyph.Security, row.glyph)
        assertEquals(RelativeAge.Days(3), row.age)
    }

    @Test
    fun projectLeavesAgeNullForUnparseableCreatedAt() {
        val row = AlertCardProjection.project(baseAlert().copy(createdAt = "bad"), strings, now)
        assertNull(row.age)
    }
}
