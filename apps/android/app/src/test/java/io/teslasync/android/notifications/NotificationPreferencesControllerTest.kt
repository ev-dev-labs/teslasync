package io.teslasync.android.notifications

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the settings-facing [NotificationPreferencesController]. */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationPreferencesControllerTest {
    @Test
    fun startLoadsPersistedPreferences() =
        runTest {
            val store = InMemoryNotificationSettingsStore(NotificationSettings.Default.copy(enabled = false))
            val controller = NotificationPreferencesController(store, this@runTest)

            controller.start()
            advanceUntilIdle()

            assertFalse(controller.settings.enabled)
        }

    @Test
    fun togglingAKindUpdatesAndPersists() =
        runTest {
            val store = InMemoryNotificationSettingsStore()
            val controller = NotificationPreferencesController(store, this@runTest)
            controller.start()
            advanceUntilIdle()

            controller.setKindEnabled(NotificationKind.Automation, false)
            advanceUntilIdle()

            assertFalse(controller.settings.isKindEnabled(NotificationKind.Automation))
            assertTrue(controller.settings.isKindEnabled(NotificationKind.Alert))
            assertEquals(controller.settings, store.load())
        }

    @Test
    fun quietHoursAndRedactionPersist() =
        runTest {
            val store = InMemoryNotificationSettingsStore()
            val controller = NotificationPreferencesController(store, this@runTest)
            controller.start()
            advanceUntilIdle()

            controller.setQuietHours(QuietHours(enabled = true, startMinuteOfDay = 1320, endMinuteOfDay = 420))
            controller.setRedactSensitiveContent(true)
            advanceUntilIdle()

            assertTrue(controller.settings.quietHours.enabled)
            assertTrue(controller.settings.redactSensitiveContent)
            assertEquals(controller.settings, store.load())
        }
}
