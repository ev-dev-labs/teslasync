package io.teslasync.android.push

/**
 * Identifiers and notification-capability flags reported to the backend at device-registration time
 * (P3/A6, ADR-009). The platform/provider strings name the push transport; the capability flags
 * describe what kinds of notification this client can present so the `notification-worker` can tailor
 * fan-out. All values are static, non-PII descriptors.
 */
object PushCapabilities {
    /** The platform identifier sent as `platform` in the registration payload. */
    const val ANDROID_PLATFORM = "android"

    /** The push transport identifier sent as `push_provider` (Firebase Cloud Messaging). */
    const val FCM_PROVIDER = "fcm"

    /** Capability: the client can present system notifications in the tray / lock screen. */
    const val NOTIFICATION = "notification"

    /** Capability: the client can render badge counters. */
    const val BADGE = "badge"

    /** Capability: the client can surface in-app alert banners while in the foreground. */
    const val ALERT = "alert"

    /** The default Android capability set (system notification + badge + in-app alert). */
    val ANDROID_DEFAULT: List<String> = listOf(NOTIFICATION, BADGE, ALERT)
}
