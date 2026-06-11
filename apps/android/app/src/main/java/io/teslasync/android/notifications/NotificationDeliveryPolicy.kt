package io.teslasync.android.notifications

/**
 * The fan-out decision for one notification (P3/A6): whether to raise the foreground in-app banner
 * and/or present a background OS notification. The two surfaces are independent so the policy can,
 * for example, banner a foreground notification without a duplicate OS notification, or suppress a
 * quiet-hours OS notification while still showing the banner.
 */
data class NotificationDelivery(
    val showBanner: Boolean,
    val showSystemNotification: Boolean,
) {
    companion object {
        /** Deliver nothing to the user (gated off entirely). */
        val None = NotificationDelivery(showBanner = false, showSystemNotification = false)
    }
}

/**
 * The inputs to a delivery decision (P3/A6): the notification's [kind]/[severity] plus the live
 * context — the user's [settings], whether the app is [isForeground], whether the OS notification
 * permission is granted ([permissionGranted]) and the local time-of-day ([nowMinuteOfDay]).
 */
data class NotificationDeliveryContext(
    val kind: NotificationKind,
    val severity: BannerSeverity,
    val settings: NotificationSettings,
    val isForeground: Boolean,
    val permissionGranted: Boolean,
    val nowMinuteOfDay: Int,
)

/**
 * Coordinates the foreground in-app banner with the background OS notification and honors the user's
 * settings, quiet hours and the runtime notification permission (P3/A6, ADR-009). The rules, in order:
 *
 * 1. The master toggle and per-kind toggle gate the user-facing surfaces — but a critical notification
 *    with breakthrough enabled still surfaces.
 * 2. While the app is foreground the user sees the in-app banner and the OS notification is suppressed
 *    (no double notification); while backgrounded the OS notification carries it.
 * 3. A background OS notification additionally requires the runtime POST_NOTIFICATIONS permission.
 * 4. Quiet hours silence the OS notification (the banner is foreground-only and unaffected) unless this
 *    is a critical breakthrough.
 *
 * Pure and total so every combination is unit-tested.
 */
object NotificationDeliveryPolicy {
    /** Decides how a notification should be delivered given the [context]. */
    fun decide(context: NotificationDeliveryContext): NotificationDelivery {
        val settings = context.settings
        val breakthrough = context.severity == BannerSeverity.Critical && settings.allowCriticalBreakthrough
        val userFacingAllowed = breakthrough || (settings.enabled && settings.isKindEnabled(context.kind))
        if (!userFacingAllowed) return NotificationDelivery.None

        val silencedByQuietHours = settings.quietHours.isQuiet(context.nowMinuteOfDay) && !breakthrough
        val showSystemNotification = !context.isForeground && context.permissionGranted && !silencedByQuietHours
        return NotificationDelivery(showBanner = context.isForeground, showSystemNotification = showSystemNotification)
    }
}
