package io.teslasync.android.settings

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.notifications.InMemoryNotificationSettingsStore
import io.teslasync.android.notifications.NotificationPreferencesController
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the [SettingsScreen] (P3/A8): exercises the theme segmented control,
 * the haptics accessibility toggle, and the privacy/telemetry opt-in, asserting each writes through to
 * the [AppSettingsController]. Runs on a device/emulator (connectedDebugAndroidTest), like the other
 * interaction tests; the controller logic itself is covered by the JVM-gate `AppSettingsControllerTest`.
 */
class SettingsInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    private val scope = CoroutineScope(Dispatchers.Main)

    private fun render(appSettings: AppSettingsController) {
        val notifications = NotificationPreferencesController(InMemoryNotificationSettingsStore(), scope)
        rule.setContent {
            TeslaSyncTheme {
                CompositionLocalProvider(LocalHapticsEnabled provides false) {
                    SettingsScreen(
                        appSettings = appSettings,
                        notifications = notifications,
                        notificationsEnabled = true,
                        languageSettingsSupported = false,
                        versionLabel = "1.0 (1)",
                        onSelectLanguage = appSettings::setLanguage,
                        onOpenNotificationSystemSettings = {},
                        onOpenLanguageSystemSettings = {},
                        onOpenPlayStore = {},
                        onClearCache = {},
                        onSignOut = {},
                    )
                }
            }
        }
    }

    @Test
    fun selectingDarkThemeUpdatesTheController() {
        val appSettings = AppSettingsController(InMemoryAppSettingsStore(), scope)
        render(appSettings)
        rule.onNodeWithText("Dark").performScrollTo().performClick()
        assertEquals(ThemeMode.Dark, appSettings.settings.themeMode)
    }

    @Test
    fun togglingHapticsOffUpdatesTheController() {
        val appSettings = AppSettingsController(InMemoryAppSettingsStore(), scope)
        render(appSettings)
        rule.onNodeWithText("Haptic feedback").performScrollTo().performClick()
        assertFalse(appSettings.settings.haptics)
    }

    @Test
    fun optingIntoDiagnosticsUpdatesTheController() {
        val appSettings = AppSettingsController(InMemoryAppSettingsStore(), scope)
        render(appSettings)
        rule.onNodeWithText("Share diagnostics & crash reports").performScrollTo().performClick()
        assertTrue(appSettings.settings.shareDiagnostics)
    }
}
