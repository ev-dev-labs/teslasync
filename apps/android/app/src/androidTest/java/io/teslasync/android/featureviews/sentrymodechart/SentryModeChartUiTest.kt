package io.teslasync.android.featureviews.sentrymodechart

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
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SentryModeChartContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the
 * populated chart with its legend, and the stale/offline cached views. Asserts the rendered i18n strings and
 * the TalkBack content descriptions (the always-visible title, the legend swatch labels, the freshness
 * chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/admin/components/security-access/SentryModeChart.tsx).
 */
class SentryModeChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<SentryDayBucket>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SentryModeChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun buckets(): List<SentryDayBucket> =
        listOf(
            SentryDayBucket(date = "2026-04-03", sentryOn = 9, sentryOff = 7),
            SentryDayBucket(date = "2026-04-04", sentryOn = 15, sentryOff = 2),
        )

    @Test
    fun loadingShowsTitleChromeAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Sentry Mode Activity").assertIsDisplayed()
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
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Sentry Mode Activity").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAndAccessibleLegendLabels() {
        setContent(UiState(UiPhase.Content, data = buckets()))
        compose.onNodeWithText("Sentry Mode Activity").assertIsDisplayed()
        compose.onNodeWithContentDescription("Sentry On").assertExists()
        compose.onNodeWithContentDescription("Sentry Off").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = buckets(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Sentry Mode Activity").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = buckets(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Sentry Mode Activity").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
