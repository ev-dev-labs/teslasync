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
 * themed home shell. Requires a connected device/emulator (run via connectedDebugAndroidTest);
 * it is not part of the A0 gate, which has no device.
 */
@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun activityLaunchesAndRendersHome() {
        val headline = composeRule.activity.getString(R.string.welcome_headline)
        composeRule.onNodeWithText(headline).assertIsDisplayed()
    }
}
