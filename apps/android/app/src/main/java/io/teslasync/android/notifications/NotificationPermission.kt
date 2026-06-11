package io.teslasync.android.notifications

/**
 * The runtime notification-permission policy (P3/A6, ADR-009). On Android 13 (API 33, Tiramisu) and
 * above the app must request the `POST_NOTIFICATIONS` runtime permission before it can post OS
 * notifications; below 33 the permission is granted at install time. Framework-free so the gating
 * rules are unit-tested; the actual request lives in a thin Compose shell.
 */
object NotificationPermission {
    /** The runtime permission name (a stable platform constant mirrored here for the headless policy). */
    const val PERMISSION = "android.permission.POST_NOTIFICATIONS"

    /** The first SDK level on which `POST_NOTIFICATIONS` is a runtime permission (Android 13). */
    const val RUNTIME_PERMISSION_SDK = 33

    /** True when [sdkInt] requires a runtime `POST_NOTIFICATIONS` request. */
    fun isRuntimePermissionRequired(sdkInt: Int): Boolean = sdkInt >= RUNTIME_PERMISSION_SDK

    /**
     * Whether the app should prompt for the permission now: only when the platform requires it, it is
     * not already granted, and the app has not already asked this session (so a denial is not nagged).
     */
    fun shouldRequest(
        sdkInt: Int,
        granted: Boolean,
        alreadyAsked: Boolean,
    ): Boolean = isRuntimePermissionRequired(sdkInt) && !granted && !alreadyAsked
}
