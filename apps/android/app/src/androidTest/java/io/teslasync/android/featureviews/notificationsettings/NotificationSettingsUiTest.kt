package io.teslasync.android.featureviews.notificationsettings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of NotificationSettings across every branch the
 * prompt's state matrix mandates (web/src/features/settings/components/NotificationSettings.tsx): the
 * granted permission (Enabled badge + per-event toggles), the default permission (Enable button), the
 * blocked notice, the unsupported notice, the tab-signals loading skeleton, the tab-signals hard error +
 * retry, the offline (cached + chip) surface, and the notification-sounds channels with the per-channel
 * Test button's localized accessible name. Every asserted string is resolved from the app's i18n
 * resources so the test follows the device locale rather than hard-coding English. The clock auto-advance
 * is disabled so the skeleton's infinite shimmer cannot stall `waitForIdle`. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + view-model.
 */
class NotificationSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(
        id: Int,
        vararg formatArgs: Any,
    ) = context.getString(id, *formatArgs)

    @Test
    fun grantedShowsEnabledBadgeAndEventToggles() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = NOW),
            permission = BrowserNotifPermission.Granted,
        )

        compose.onNodeWithText(string(R.string.translation_browserNotifications_enabled)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_browserNotifications_alerts)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_browserNotifications_exportStatus)).assertIsDisplayed()
    }

    @Test
    fun defaultShowsEnableButton() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = NOW),
            permission = BrowserNotifPermission.Default,
        )

        compose.onNodeWithText(string(R.string.translation_browserNotifications_enable)).assertIsDisplayed()
    }

    @Test
    fun blockedShowsTheBlockedNotice() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = NOW),
            permission = BrowserNotifPermission.Denied,
        )

        compose.onNodeWithText(string(R.string.translation_browserNotifications_blocked)).assertIsDisplayed()
    }

    @Test
    fun unsupportedShowsTheUnsupportedNotice() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = NOW),
            permission = BrowserNotifPermission.Default,
            notificationsSupported = false,
        )

        compose.onNodeWithText(string(R.string.translation_browserNotifications_unsupported)).assertIsDisplayed()
    }

    @Test
    fun tabSignalsLoadingShowsTheLoadingLabel() {
        setContent(tabSignals = UiState.loading(), permission = BrowserNotifPermission.Granted)

        compose.onNodeWithContentDescription(string(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun tabSignalsErrorShowsTheFailureAndRetry() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown),
            permission = BrowserNotifPermission.Granted,
        )

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipBeneathTheCachedToggles() {
        setContent(
            tabSignals =
                UiState(
                    phase = UiPhase.Content,
                    data = TabSignals.DEFAULT,
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            permission = BrowserNotifPermission.Granted,
        )

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_settings_tab_badge)).assertIsDisplayed()
    }

    @Test
    fun soundChannelsExposeTheLocalizedTestAccessibleName() {
        setContent(
            tabSignals = UiState(phase = UiPhase.Content, data = TabSignals.DEFAULT, fetchedAt = NOW),
            permission = BrowserNotifPermission.Granted,
            soundPrefs = NotificationSoundPrefs.DEFAULT.copy(master = true),
        )

        // a11y: the per-channel Test control names which channel it cues (web `Test {{name}} sound`).
        val criticalLabel = string(R.string.translation_notificationSounds_category_critical_alert)
        compose.onNodeWithText(string(R.string.translation_notificationSounds_title)).assertIsDisplayed()
        compose.onNodeWithText(criticalLabel).assertIsDisplayed()
        compose
            .onNodeWithContentDescription(string(R.string.translation_notificationSounds_testAria, criticalLabel))
            .assertIsDisplayed()
    }

    private fun setContent(
        tabSignals: UiState<TabSignals>,
        permission: BrowserNotifPermission,
        notificationsSupported: Boolean = true,
        soundPrefs: NotificationSoundPrefs = NotificationSoundPrefs.DEFAULT,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScrollableHost {
                    NotificationSettingsContent(
                        tabSignals = tabSignals,
                        soundPrefs = soundPrefs,
                        webPushPrefs = WebPushPrefs.DEFAULT,
                        permission = permission,
                        notificationsSupported = notificationsSupported,
                        showAutoplayHint = soundPrefs.master,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Composable
    private fun ScrollableHost(content: @Composable () -> Unit) {
        Box(
            modifier =
                Modifier
                    .size(width = WIDTH, height = HEIGHT)
                    .verticalScroll(rememberScrollState()),
        ) {
            content()
        }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        const val SETTLE_MS = 2_000L
        val WIDTH = 400.dp
        val HEIGHT = 1_400.dp
    }
}
