package io.teslasync.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented launch test: the single Activity starts, sets Compose content, and renders the
 * adaptive navigation shell. The start destination (Dashboard) has no A7 page host in this
 * foundation, so it resolves to the shared not-found screen — asserting its body proves the
 * NavHost wired up and rendered. Requires a connected device/emulator (connectedDebugAndroidTest);
 * it is not part of the A3 gate, which has no device.
 */
@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun activityLaunchesAndRendersShell() {
        val notFoundBody = composeRule.activity.getString(R.string.nav_not_found_body)
        composeRule.onNodeWithText(notFoundBody, substring = true).assertIsDisplayed()
    }
}
