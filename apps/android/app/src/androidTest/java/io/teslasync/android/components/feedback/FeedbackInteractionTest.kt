package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the feedback family — the loading / empty / error / banner
 * surfaces every page leans on so a data region is never blank. The pure countdown/classify logic
 * is covered by the no-device [FeedbackLogicTest]; these assert the surfaces render their copy,
 * expose accessible names, and fire their actions on a device (connectedDebugAndroidTest).
 */
class FeedbackInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun emptyStateShowsMessageAndFiresAction() {
        var clicked = false
        rule.setContent {
            TeslaSyncTheme {
                EmptyState(
                    message = "No drives yet",
                    title = "Nothing here",
                    action = EmptyStateAction(label = "Add drive", onClick = { clicked = true }),
                )
            }
        }
        rule.onNodeWithText("No drives yet").assertIsDisplayed()
        rule.onNodeWithText("Add drive").performClick()
        assertTrue(clicked)
    }

    @Test
    fun errorDisplayShowsMessageAndFiresRetry() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ErrorDisplay(message = "Could not load drives", onRetry = { retried = true })
            }
        }
        rule.onNodeWithText("Could not load drives").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun spinnerExposesSingleAccessibleLabel() {
        rule.setContent { TeslaSyncTheme { Spinner(label = "Loading drives") } }
        rule.onNodeWithContentDescription("Loading drives").assertIsDisplayed()
    }

    @Test
    fun skeletonComposesWithoutCrashing() {
        rule.setContent {
            TeslaSyncTheme {
                Box(modifier = Modifier.testTag("skeleton")) { Skeleton(widthFraction = 0.5f) }
            }
        }
        rule.onNodeWithTag("skeleton").assertIsDisplayed()
    }

    @Test
    fun offlineBannerShowsTitleAndFiresRetry() {
        var retried = false
        rule.setContent { TeslaSyncTheme { OfflineBanner(onRetry = { retried = true }) } }
        rule.onNodeWithText("Offline").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun liveStaleDataBannerShowsAndFiresReconnect() {
        var reconnected = false
        rule.setContent {
            TeslaSyncTheme {
                LiveStaleDataBanner(staleForLabel = "3 min", onReconnect = { reconnected = true })
            }
        }
        rule.onNodeWithText("Live data stale").assertIsDisplayed()
        rule.onNodeWithText("Reconnect").performClick()
        assertTrue(reconnected)
    }

    @Test
    fun alertBannerShowsTitleAndMessage() {
        rule.setContent {
            TeslaSyncTheme {
                AlertBanner(message = "Scheduled maintenance soon", title = "Heads up", tone = Tone.Info)
            }
        }
        rule.onNodeWithText("Heads up").assertIsDisplayed()
        rule.onNodeWithText("Scheduled maintenance soon").assertIsDisplayed()
    }

    @Test
    fun queryErrorOfflineShowsDisabledRetry() {
        rule.setContent {
            TeslaSyncTheme {
                QueryError(kind = QueryErrorKind.Offline, onRetry = {})
            }
        }
        rule.onNodeWithText("You're offline").assertIsDisplayed()
        rule.onNodeWithText("Retry when online").assertIsNotEnabled()
    }
}
