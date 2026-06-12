package io.teslasync.android.featureviews.statchartslide

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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [StatChartSlideContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the populated
 * slide (count-up + caption + chart), and the stale/offline cached views. Asserts the rendered i18n strings
 * and the TalkBack content descriptions (the merged "{n} drives" figure, the freshness chip). The offline
 * gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/review/StatChartSlide.tsx).
 */
class StatChartSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<StatChartData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatChartSlideContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun data(): StatChartData =
        StatChartData(
            totalDrives = 342.0,
            avgDrivesPerWeek = 6.6,
            monthlyStats =
                listOf(
                    StatChartMonth(month = 1, drives = 24.0),
                    StatChartMonth(month = 2, drives = 28.0),
                    StatChartMonth(month = 3, drives = 31.0),
                ),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
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
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersAccessibleDriveCountAndCaption() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithContentDescription("342 drives").assertIsDisplayed()
        compose.onNodeWithText("6.6 drives per week on average").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedSlideWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithContentDescription("342 drives").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithContentDescription("342 drives").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
