package io.teslasync.android.featureviews.privacy

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [PrivacySectionContent] across every state the
 * web component renders: the loading skeleton chrome, the resolved panel (recent-pages card + consent
 * card), the recent-pages empty handling (count 0 → disabled clear), the clear confirm-dialog flow, the
 * consent-state-driven button enablement + labels, and the version offline freshness chip. Asserts the
 * rendered catalog strings and that every interactive control exposes a TalkBack label. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + holder
 * logic, this covers the render + a11y.
 */
class PrivacySectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: PrivacyUiState,
        onClearConfirmed: () -> Unit = {},
        onAccept: () -> Unit = {},
        onDecline: () -> Unit = {},
        onReset: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    PrivacySectionContent(
                        state = state,
                        onClearConfirmed = onClearConfirmed,
                        onAccept = onAccept,
                        onDecline = onDecline,
                        onReset = onReset,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChromeUnderTheHeader() {
        setContent(PrivacyUiState.Loading)
        compose.onNodeWithText("Privacy").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun contentShowsBothCardsAndConsentState() {
        setContent(content(recentCount = 5, consent = ConsentState.Unknown, requireConsent = false))
        compose.onNodeWithText("Privacy").assertIsDisplayed()
        compose.onNodeWithText("Recently viewed pages").assertIsDisplayed()
        compose.onNodeWithText("Cookies & analytics consent").assertIsDisplayed()
        compose.onNodeWithText("Not decided", substring = true).assertIsDisplayed()
        // requireConsent = false → the "does not require consent collection" sentence.
        compose.onNodeWithText("does not require consent collection", substring = true).assertIsDisplayed()
    }

    @Test
    fun requireConsentSelectsTheOnSentence() {
        setContent(content(recentCount = 1, consent = ConsentState.Unknown, requireConsent = true))
        compose.onNodeWithText("collects anonymous performance", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyRecentPagesDisablesTheClearButton() {
        setContent(content(recentCount = 0, consent = ConsentState.Unknown, requireConsent = false))
        compose.onNodeWithText("Clear recent pages").assertIsNotEnabled()
    }

    @Test
    fun clearFlowConfirmsThenInvokesCallback() {
        var cleared = 0
        setContent(
            state = content(recentCount = 3, consent = ConsentState.Unknown, requireConsent = false),
            onClearConfirmed = { cleared += 1 },
        )
        compose.onNodeWithText("Clear recent pages").assertIsEnabled().performClick()
        // The warning confirm dialog appears (web ConfirmDialog).
        compose.onNodeWithText("Clear recent pages?").assertIsDisplayed()
        compose.onNodeWithText("Clear pages").performClick()
        assertEquals(1, cleared)
    }

    @Test
    fun consentButtonsAreLabeledAndReflectState() {
        var accepted = 0
        var declined = 0
        var reset = 0
        setContent(
            state = content(recentCount = 2, consent = ConsentState.Accepted, requireConsent = true),
            onAccept = { accepted += 1 },
            onDecline = { declined += 1 },
            onReset = { reset += 1 },
        )
        // All three actions carry TalkBack-readable labels; the current state's action is disabled.
        compose.onNodeWithText("Re-grant consent").assertIsNotEnabled()
        compose.onNodeWithText("Withdraw consent").assertIsEnabled().performClick()
        compose.onNodeWithText("Reset").assertIsEnabled().performClick()
        assertEquals(0, accepted)
        assertEquals(1, declined)
        assertEquals(1, reset)
    }

    @Test
    fun versionOfflineShowsLabeledRefreshAffordance() {
        setContent(
            content(
                recentCount = 4,
                consent = ConsentState.Unknown,
                requireConsent = false,
                version =
                    UiState(
                        phase = UiPhase.Content,
                        data = false,
                        fetchedAt = NOW,
                        stale = true,
                        errorKind = io.teslasync.android.data.ErrorKind.Network,
                    ),
            ),
        )
        // The freshness chip's retry control is reachable by its accessibility label.
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun content(
        recentCount: Int,
        consent: ConsentState,
        requireConsent: Boolean,
        version: UiState<Boolean> = UiState(phase = UiPhase.Content, data = requireConsent, fetchedAt = NOW),
    ): PrivacyUiState.Content =
        PrivacyUiState.Content(
            snapshot = PrivacySnapshot(recentCount = recentCount, consent = consent, requireConsent = requireConsent),
            version = version,
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
