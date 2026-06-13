package io.teslasync.android.sharedsurfaces.elevationprofile

import androidx.compose.ui.test.assertExists
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
 * On-device Compose UI + accessibility verification of [ElevationProfileContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated chart, and
 * the stale/offline cached view. Asserts the rendered i18n strings (the real catalog resolves the
 * `replay.elevation.*` keys), the chart's accessible description (the web aria label, the chart-a11y:no-table
 * fallback), the gain/loss subtitle, and the freshness chip's TalkBack label. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/components/charts/ElevationProfile.tsx).
 */
class ElevationProfileUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Elevation Profile"
    private val aria = "Elevation profile chart \u2014 no data available yet"

    private fun setContent(
        state: UiState<ElevationProfileData>,
        currentIndex: Int? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ElevationProfileContent(
                    state = state,
                    onRetry = onRetry,
                    currentIndex = currentIndex,
                )
            }
        }
    }

    private fun data(): ElevationProfileData =
        ElevationProfileData(
            points =
                listOf(
                    ElevationProfilePoint(index = 0, distance = 0.0, elevation = 120.0, speed = 0.0),
                    ElevationProfilePoint(index = 1, distance = 1.2, elevation = 168.0, speed = 42.0),
                    ElevationProfilePoint(index = 2, distance = 2.6, elevation = 210.0, speed = 65.0),
                    ElevationProfilePoint(index = 3, distance = 3.9, elevation = 184.0, speed = 58.0),
                    ElevationProfilePoint(index = 4, distance = 5.1, elevation = 142.0, speed = 31.0),
                ),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(title).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("This chart failed to load").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = ElevationProfileData(emptyList())))
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No elevation data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleDescriptionAndGainLossSubtitle() {
        setContent(UiState(UiPhase.Content, data = data()), currentIndex = 2)
        compose.onNodeWithText(title).assertIsDisplayed()
        // The chart's accessible description is the web aria label (the chart-a11y:no-table fallback).
        compose.onNodeWithContentDescription(aria).assertExists()
        // Cumulative gain/loss subtitle: diffs +48,+42,-26,-42 → gain 90, loss 68.
        compose.onNodeWithText("90m", substring = true).assertExists()
        compose.onNodeWithText("68m", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(title).assertIsDisplayed()
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
        compose.onNodeWithText(title).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
