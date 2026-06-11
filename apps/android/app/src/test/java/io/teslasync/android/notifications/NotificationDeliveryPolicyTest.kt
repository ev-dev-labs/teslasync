package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [NotificationDeliveryPolicy] — the foreground-banner vs background-OS-notification
 * decision under the permission, per-kind, quiet-hours and critical-breakthrough rules (P3/A6, ADR-009).
 */
class NotificationDeliveryPolicyTest {
    private val quietNow = 650
    private val quietWindow = QuietHours(enabled = true, startMinuteOfDay = 600, endMinuteOfDay = 700)
    private val base =
        NotificationDeliveryContext(
            kind = NotificationKind.Generic,
            severity = BannerSeverity.Info,
            settings = NotificationSettings.Default,
            isForeground = false,
            permissionGranted = true,
            nowMinuteOfDay = 100,
        )

    @Test
    fun foregroundShowsTheBannerAndSuppressesTheOsNotification() {
        val delivery = NotificationDeliveryPolicy.decide(base.copy(isForeground = true))
        assertTrue(delivery.showBanner)
        assertFalse(delivery.showSystemNotification)
    }

    @Test
    fun backgroundWithPermissionShowsTheOsNotification() {
        val delivery = NotificationDeliveryPolicy.decide(base.copy(isForeground = false))
        assertFalse(delivery.showBanner)
        assertTrue(delivery.showSystemNotification)
    }

    @Test
    fun backgroundWithoutPermissionShowsNothing() {
        val delivery = NotificationDeliveryPolicy.decide(base.copy(isForeground = false, permissionGranted = false))
        assertEquals(NotificationDelivery.None, delivery)
    }

    @Test
    fun quietHoursSuppressTheOsNotificationForNonCritical() {
        val delivery =
            NotificationDeliveryPolicy.decide(
                base.copy(settings = NotificationSettings(quietHours = quietWindow), nowMinuteOfDay = quietNow),
            )
        assertFalse(delivery.showSystemNotification)
    }

    @Test
    fun criticalBreakthroughSurfacesDuringQuietHours() {
        val delivery =
            NotificationDeliveryPolicy.decide(
                base.copy(
                    kind = NotificationKind.Alert,
                    severity = BannerSeverity.Critical,
                    settings = NotificationSettings(quietHours = quietWindow),
                    nowMinuteOfDay = quietNow,
                ),
            )
        assertTrue(delivery.showSystemNotification)
    }

    @Test
    fun aDisabledKindIsGatedOff() {
        val delivery =
            NotificationDeliveryPolicy.decide(base.copy(settings = NotificationSettings(enabledKinds = emptySet())))
        assertEquals(NotificationDelivery.None, delivery)
    }

    @Test
    fun theMasterToggleGatesNonCriticalNotifications() {
        val delivery =
            NotificationDeliveryPolicy.decide(base.copy(settings = NotificationSettings(enabled = false), isForeground = true))
        assertEquals(NotificationDelivery.None, delivery)
    }

    @Test
    fun criticalBreakthroughOverridesADisabledKind() {
        val delivery =
            NotificationDeliveryPolicy.decide(
                base.copy(
                    kind = NotificationKind.Alert,
                    severity = BannerSeverity.Critical,
                    settings = NotificationSettings(enabled = false, enabledKinds = emptySet()),
                    isForeground = true,
                ),
            )
        assertTrue(delivery.showBanner)
    }

    @Test
    fun disablingBreakthroughKeepsCriticalSubjectToTheToggles() {
        val delivery =
            NotificationDeliveryPolicy.decide(
                base.copy(
                    kind = NotificationKind.Alert,
                    severity = BannerSeverity.Critical,
                    settings = NotificationSettings(enabled = false, allowCriticalBreakthrough = false),
                    isForeground = true,
                ),
            )
        assertEquals(NotificationDelivery.None, delivery)
    }
}
