package io.teslasync.android.featureviews.xraybucketchart

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
 * On-device Compose UI + accessibility verification of [XRayBucketChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the
 * populated chart, and the stale/offline cached view. Asserts the rendered i18n strings, the chart's
 * accessible description (web `ariaLabel`), and the freshness chip's TalkBack label. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx).
 */
class XRayBucketChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<XRayBucketPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                XRayBucketChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun buckets(): List<XRayBucketPoint> =
        listOf(
            XRayBucketPoint(bucketStart = "2026-04-04T14:00:00Z", count = 1_204),
            XRayBucketPoint(bucketStart = "2026-04-04T15:00:00Z", count = 1_877),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Samples per bucket").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Samples per bucket").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = buckets()))
        compose.onNodeWithText("Samples per bucket").assertIsDisplayed()
        compose.onNodeWithContentDescription("Bar chart of ingest sample counts per time bucket.").assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
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
        compose.onNodeWithText("Samples per bucket").assertIsDisplayed()
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
        compose.onNodeWithText("Samples per bucket").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
