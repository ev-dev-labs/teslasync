package io.teslasync.android.featureviews.chargingbreakdownslide

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * On-device Compose UI + accessibility verification of [ChargingBreakdownSlideContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the
 * populated slide (headline, subtext, donut, legend), and the stale/offline cached views. Asserts the
 * rendered i18n strings and the TalkBack content descriptions (the accessible loading label, the combined
 * donut breakdown, the legend swatch labels, the offline freshness chip). The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx).
 */
class ChargingBreakdownSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ChargingBreakdownData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargingBreakdownSlideContent(
                    state = state,
                    onRetry = onRetry,
                )
            }
        }
    }

    private fun mix(): ChargingBreakdownData =
        ChargingBreakdownData(
            totalChargeSessions = 147,
            superchargerPct = 62.0,
            dcFastPct = 30.0,
            acOtherPct = 8.0,
            avgChargeStartSoc = 38.4,
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankSlide() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
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
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersHeadlineSubtextDonutAndLegend() {
        setContent(UiState(UiPhase.Content, data = mix()))
        compose.onNodeWithText("147 charge sessions").assertIsDisplayed()
        compose.onNodeWithText("Average plug-in at 38% battery").assertIsDisplayed()
        compose.onNodeWithText("Supercharger (62%)").assertExists()
        compose.onNodeWithText("AC / Other (8%)").assertExists()
        compose
            .onNodeWithContentDescription("Supercharger (62%), DC Fast (30%), AC / Other (8%)")
            .assertExists()
    }

    @Test
    fun offlineShowsCachedSlideWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mix(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("147 charge sessions").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = mix(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("147 charge sessions").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
