package io.teslasync.android.featureviews.subscribecard

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SubscribeCardContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty state, the loaded card, and the
 * stale/offline cached views. Asserts the rendered i18n + verbatim strings, that taps fire the right navigation
 * callback, and that each tile is a click-actionable accessibility node. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection, this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/status/SubscribeCard.tsx).
 *
 * The asserted strings are the resolved catalog values for the keyed regions (the heading
 * `translation_checklist_tasks_notify_title`, the "Email" and "Browser push" labels) and the verbatim copy for the
 * regions the catalog has no key for (Slack / Discord / Webhook + the delivery descriptors).
 */
class SubscribeCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun channels() = SubscribeCardProjection.channels()

    private fun setContent(
        state: UiState<List<SubscribeChannel>>,
        actions: SubscribeCardActions = SubscribeCardActions(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SubscribeCardContent(state = state, actions = actions, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersHeadingSubtitleAndEveryChannelTile() {
        setContent(UiState(UiPhase.Content, data = channels()))

        compose.onNodeWithText("Add a notification channel").assertIsDisplayed()
        compose.onNodeWithText("Where alert messages are delivered.", substring = true).assertIsDisplayed()

        compose.onNodeWithText("Email").assertIsDisplayed()
        compose.onNodeWithText("SMTP-based delivery").assertIsDisplayed()
        compose.onNodeWithText("Slack").assertIsDisplayed()
        compose.onNodeWithText("Discord").assertIsDisplayed()
        compose.onNodeWithText("Webhook").assertIsDisplayed()
        compose.onNodeWithText("Custom HTTP endpoint").assertIsDisplayed()
        compose.onNodeWithText("Browser push").assertIsDisplayed()
        compose.onNodeWithText("Opt-in PWA notifications").assertIsDisplayed()

        // The Slack and Discord tiles share the "Webhook channel" descriptor.
        compose.onAllNodesWithText("Webhook channel").assertCountEquals(2)
    }

    @Test
    fun everyTileIsAClickActionableAccessibilityNode() {
        setContent(UiState(UiPhase.Content, data = channels()))
        compose.onNodeWithText("Email").assertHasClickAction()
        compose.onNodeWithText("Slack").assertHasClickAction()
        compose.onNodeWithText("Discord").assertHasClickAction()
        compose.onNodeWithText("Webhook").assertHasClickAction()
        compose.onNodeWithText("Browser push").assertHasClickAction()
    }

    @Test
    fun channelTileTapInvokesOpenChannels() {
        var opened = false
        setContent(
            state = UiState(UiPhase.Content, data = channels()),
            actions = SubscribeCardActions(onOpenChannels = { opened = true }),
        )
        compose.onNodeWithText("Email").performClick()
        assertTrue(opened)
    }

    @Test
    fun browserPushTileTapInvokesOpenBrowserPush() {
        var opened = false
        setContent(
            state = UiState(UiPhase.Content, data = channels()),
            actions = SubscribeCardActions(onOpenBrowserPush = { opened = true }),
        )
        compose.onNodeWithText("Browser push").performClick()
        assertTrue(opened)
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = channels(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Email").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedTiles() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = channels(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Email").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
