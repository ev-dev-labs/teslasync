package io.teslasync.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented launch test: the single Activity starts, applies the Material 3 theme, and renders
 * the real Compose content. The production root ([io.teslasync.android.ui.App]) gates the shell
 * behind the auth state machine (ADR-008), so a cold launch with no stored session resolves to the
 * signed-out sign-in surface — asserting it proves the Activity launched and the auth-gated Compose
 * tree wired up. Requires a connected device/emulator (connectedDebugAndroidTest); it is not part of
 * the A3/A9-0001 unit gate, which has no device.
 */
@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun activityLaunchesAndRendersAuthGate() {
        val signIn = composeRule.activity.getString(R.string.auth_sign_in)
        composeRule.waitUntil(LAUNCH_TIMEOUT_MS) {
            composeRule.onAllNodesWithText(signIn).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText(signIn).assertIsDisplayed()
    }

    private companion object {
        const val LAUNCH_TIMEOUT_MS = 10_000L
    }
}
