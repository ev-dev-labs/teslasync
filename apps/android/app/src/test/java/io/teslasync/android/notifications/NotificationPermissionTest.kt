package io.teslasync.android.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [NotificationPermission] — the runtime POST_NOTIFICATIONS gating policy (P3/A6). */
class NotificationPermissionTest {
    @Test
    fun runtimePermissionIsRequiredOnApi33AndAbove() {
        assertFalse(NotificationPermission.isRuntimePermissionRequired(32))
        assertTrue(NotificationPermission.isRuntimePermissionRequired(33))
        assertTrue(NotificationPermission.isRuntimePermissionRequired(36))
    }

    @Test
    fun belowApi33TheAppNeverPrompts() {
        assertFalse(NotificationPermission.shouldRequest(sdkInt = 26, granted = false, alreadyAsked = false))
    }

    @Test
    fun promptsOnceWhenRequiredUngrantedAndNotYetAsked() {
        assertTrue(NotificationPermission.shouldRequest(sdkInt = 33, granted = false, alreadyAsked = false))
    }

    @Test
    fun doesNotPromptWhenAlreadyGrantedOrAlreadyAsked() {
        assertFalse(NotificationPermission.shouldRequest(sdkInt = 33, granted = true, alreadyAsked = false))
        assertFalse(NotificationPermission.shouldRequest(sdkInt = 33, granted = false, alreadyAsked = true))
    }
}
